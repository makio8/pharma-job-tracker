/**
 * Avature キャリアページ用スクレイパー
 *
 * Avature は採用管理プラットフォーム。
 * RSS フィードが利用可能で、全求人を一括取得できる。
 * RSS で基本情報（タイトル、URL、掲載日）を取得し、
 * 詳細ページから description 等を補完する。
 *
 * RSS フィード URL: /en_GB/careers/SearchJobs/feed/
 * HTML 一覧 URL: /en_GB/careers/SearchJobs
 * 詳細ページ: /en_GB/careers/JobDetail/{slug}/{jobId}
 *
 * 対応企業: アステラス製薬（astellas）
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

export class AvatureScraper extends BaseScraper {
  companyId: string;
  readonly url: string;
  private baseUrl: string;

  /**
   * @param companyId  - 内部企業ID
   * @param avatureHost - Avature のホスト名（例: 'astellasjapan.avature.net'）
   * @param locale     - ロケール（例: 'en_GB' or 'ja_JP'）
   * @param portalPath - ポータルパス（例: 'careers'）
   */
  constructor(
    companyId: string,
    avatureHost: string,
    locale: string = 'en_GB',
    portalPath: string = 'careers',
  ) {
    super();
    this.companyId = companyId;
    this.baseUrl = `https://${avatureHost}/${locale}/${portalPath}`;
    // RSS フィードから全件取得
    this.url = `${this.baseUrl}/SearchJobs`;
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    // ── まず RSS フィードからリストを取得 ──
    const rssUrl = `${this.baseUrl}/SearchJobs/feed/`;
    let rssJobs: Array<{ title: string; url: string; externalId?: string; pubDate?: string }> = [];

    try {
      const rssPage = await page.context().newPage();
      try {
        await rssPage.goto(rssUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });

        // RSS XML をパース
        rssJobs = await rssPage.evaluate(() => {
          const items = document.querySelectorAll('item');
          const results: Array<{ title: string; url: string; externalId?: string; pubDate?: string }> = [];

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const title = item.querySelector('title')?.textContent?.trim() || '';
            const link = item.querySelector('link')?.textContent?.trim() || '';
            const description = item.querySelector('description')?.textContent?.trim() || '';
            const pubDate = item.querySelector('pubDate')?.textContent?.trim();

            if (!title || !link) continue;

            // external_id: description に "- 12225" 形式で含まれる or URL末尾の数値
            let externalId: string | undefined;
            const descMatch = description.match(/-\s*(\d+)/);
            if (descMatch) {
              externalId = descMatch[1];
            } else {
              const urlMatch = link.match(/\/(\d+)\/?$/);
              externalId = urlMatch?.[1];
            }

            results.push({ title, url: link, externalId, pubDate });
          }

          return results;
        });

        logger.info(`${this.companyId}: RSS から ${rssJobs.length} 件取得`);
      } finally {
        try { await rssPage.close(); } catch { /* ignore */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`${this.companyId}: RSS 取得失敗 (${msg})、HTML フォールバック実行`);
    }

    // RSS で取得できなかった場合は HTML 一覧からフォールバック
    if (rssJobs.length === 0) {
      rssJobs = await this.extractFromHtmlList(page);
    }

    if (rssJobs.length === 0) {
      return [];
    }

    // ── 詳細ページから description / department / location を取得 ──
    const jobs: JobListing[] = [];
    const detailLimit = 50;

    for (const rssJob of rssJobs.slice(0, detailLimit)) {
      const job: JobListing = {
        title: rssJob.title,
        url: rssJob.url,
        externalId: rssJob.externalId,
      };

      let detailPage: Page | null = null;
      try {
        detailPage = await page.context().newPage();
        await detailPage.goto(rssJob.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

        // 詳細ページから情報を抽出
        const detail = await detailPage.evaluate((labelSets: Record<string, string[]>) => {
          const result: Record<string, string | undefined> = {};

          // テーブル or dt/dd パターンでラベル→値を取得
          for (const [key, labels] of Object.entries(labelSets)) {
            const rows = document.querySelectorAll('tr, dt, th, .field-label, [class*="label"]');
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const text = row.textContent?.trim() || '';
              for (const label of labels) {
                if (!text.includes(label)) continue;

                const valueCell =
                  row.querySelector('td:last-child') ||
                  row.nextElementSibling;
                if (valueCell?.textContent?.trim()) {
                  result[key] = valueCell.textContent.trim();
                  break;
                }
              }
              if (result[key]) break;
            }
          }

          // description フォールバック: メインコンテンツ全体
          if (!result.description) {
            const main = document.querySelector(
              '.job-description, [class*="description"], [class*="detail"], main, article, .content',
            );
            if (main?.textContent?.trim()) {
              result.description = main.textContent.trim().slice(0, 5000);
            }
          }

          return result;
        }, {
          description: ['仕事内容', '職務内容', '業務内容', 'Job Description', 'Description', 'Responsibilities'],
          requirements: ['応募資格', '応募要件', '必須条件', 'Qualifications', 'Requirements', 'What you need'],
          department: ['部門', '部署', 'Department', 'Division', 'Function'],
          location: ['勤務地', 'Location', 'Office'],
        });

        job.description = detail.description;
        job.requirements = detail.requirements;
        if (detail.department) job.department = detail.department;
        if (detail.location) job.location = detail.location;

        logger.info(`${this.companyId}: 詳細取得成功 - ${rssJob.externalId || rssJob.title.slice(0, 30)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`${this.companyId}: 詳細取得失敗 (${rssJob.externalId}): ${msg}`);
      } finally {
        if (detailPage) {
          try { await detailPage.close(); } catch { /* ignore */ }
        }
      }

      // 自動分類
      const textCat = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(textCat);
      job.therapeuticArea = classifyTherapeuticArea(`${job.title} ${job.description ?? ''}`);

      jobs.push(job);
    }

    return jobs;
  }

  /** HTML 一覧ページから求人リストを取得（RSS フォールバック） */
  private async extractFromHtmlList(page: Page): Promise<Array<{ title: string; url: string; externalId?: string }>> {
    // ページネーション対応（10件/ページ、jobOffset パラメータ）
    const allLinks: Array<{ title: string; url: string; externalId?: string }> = [];

    for (let offset = 0; offset < 200; offset += 10) {
      const pageUrl = offset === 0
        ? this.url
        : `${this.url}?jobOffset=${offset}`;

      let listPage: Page | null = null;
      try {
        if (offset === 0) {
          listPage = page; // 最初のページは既にロード済み
        } else {
          listPage = await page.context().newPage();
          await listPage.goto(pageUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });
        }

        const links = await listPage.evaluate(() => {
          const results: Array<{ title: string; url: string; externalId?: string }> = [];

          // Avature の求人カードセレクタ
          const cards = document.querySelectorAll('article.article--result, [class*="job-item"], [class*="result"] li');

          for (let i = 0; i < cards.length; i++) {
            const card = cards[i];
            const linkEl = card.querySelector('a[href*="JobDetail"], a[href*="job"]') as HTMLAnchorElement | null;
            if (!linkEl) continue;

            const title = linkEl.textContent?.trim()
              || card.querySelector('[class*="title"]')?.textContent?.trim()
              || '';
            if (!title || title.length < 3) continue;

            const href = linkEl.href;
            const idMatch = href.match(/\/(\d+)\/?$/);

            results.push({
              title,
              url: href,
              externalId: idMatch?.[1],
            });
          }

          return results;
        });

        if (links.length === 0 && offset > 0) break;
        allLinks.push(...links);

        logger.info(`${this.companyId}: HTML一覧 offset=${offset} → ${links.length} 件`);
      } catch {
        break;
      } finally {
        if (listPage && listPage !== page) {
          try { await listPage.close(); } catch { /* ignore */ }
        }
      }
    }

    logger.info(`${this.companyId}: HTML一覧から合計 ${allLinks.length} 件取得`);
    return allLinks;
  }
}

// ── 企業インスタンス ────────────────────────────────

/** アステラス製薬 */
export const astellasScraper = new AvatureScraper(
  'astellas',
  'astellasjapan.avature.net',
  'en_GB',
  'careers',
);
