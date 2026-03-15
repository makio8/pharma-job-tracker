/**
 * Axol キャリアページ用スクレイパー
 *
 * Axol (axol.jp) は日本の採用管理プラットフォーム。
 * サーバーサイドレンダリングの従来型 HTML ページ。
 * 求人一覧は /public/entry ページに表示される。
 *
 * 対応企業: 田辺三菱製薬（mtpc）
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

export class AxolScraper extends BaseScraper {
  companyId: string;
  readonly url: string;
  private baseUrl: string;

  /**
   * @param companyId  - 内部企業ID
   * @param axolSlug   - Axol の URL パスに使われるスラッグ（例: 'mtpc'）
   */
  constructor(companyId: string, axolSlug: string) {
    super();
    this.companyId = companyId;
    this.baseUrl = `https://job.axol.jp/bx/c/${axolSlug}`;
    // 求人一覧ページを直接開く
    this.url = `${this.baseUrl}/public/entry`;
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    // 求人リンクが表示されるまで待つ
    await page.waitForSelector('a[href*="entry_"], a[href*="jobentry"]', { timeout: 10_000 })
      .catch(() => {
        logger.warn(`${this.companyId}: 求人リンクが見つかりません`);
      });

    // 一覧ページから求人を抽出
    const baseUrl = this.baseUrl;
    const jobLinks = await page.evaluate((base: string) => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        department?: string;
        location?: string;
      }> = [];

      // Axol の求人リンクは entry_{id} パターン
      const links = document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="entry_"], a[href*="/jobentry"]',
      );

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (link.closest('nav, header, footer')) continue;

        const title = link.textContent?.trim() || '';
        if (!title || title.length < 4) continue;
        // UIテキストを除外
        if (/応募|ログイン|検索|トップ|一覧|戻る/i.test(title)) continue;

        const href = link.href || link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `${base}${href}`;

        // external_id を URL パスから抽出
        const match = href.match(/entry_([^/]+)/);
        const externalId = match?.[1];

        // 親要素からメタ情報を取得
        const row = link.closest('tr, li, [class*="item"], [class*="card"], div') || link.parentElement;

        const locEl = row?.querySelector('[class*="area"], [class*="location"], [class*="place"]');
        const location = locEl?.textContent?.trim();

        const deptEl = row?.querySelector('[class*="dept"], [class*="category"], [class*="division"]');
        const department = deptEl?.textContent?.trim();

        results.push({ title, url: fullUrl, externalId, location, department });
      }

      return results;
    }, baseUrl);

    logger.info(`${this.companyId}: 一覧ページから ${jobLinks.length} 件の求人を検出`);

    if (jobLinks.length === 0) {
      return [];
    }

    // 詳細ページを取得（新しいタブで）
    const jobs: JobListing[] = [];

    for (const link of jobLinks.slice(0, 30)) {
      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId: link.externalId,
        department: link.department,
        location: link.location,
      };

      let detailPage: Page | null = null;
      try {
        detailPage = await page.context().newPage();
        await detailPage.goto(link.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

        // Axol の詳細ページはテーブル形式が多い
        const detail = await detailPage.evaluate((labelSets: Record<string, string[]>) => {
          const result: Record<string, string | undefined> = {};

          for (const [key, labels] of Object.entries(labelSets)) {
            const rows = document.querySelectorAll('tr, dt, th');
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

          // フォールバック: 本文全体
          if (!result.description) {
            const main = document.querySelector('main, article, [class*="detail"], [class*="content"]');
            if (main?.textContent?.trim()) result.description = main.textContent.trim();
          }

          return result;
        }, {
          description: ['仕事内容', '職務内容', '業務内容', '募集内容'],
          requirements: ['応募資格', '応募要件', '必須条件', '求める人材'],
          department: ['部門', '部署', '配属先', '所属'],
          location: ['勤務地', '就業場所', '勤務場所'],
        });

        job.description = detail.description;
        job.requirements = detail.requirements;
        if (!job.department && detail.department) job.department = detail.department;
        if (!job.location && detail.location) job.location = detail.location;

        logger.info(`${this.companyId}: 詳細取得成功 - ${link.externalId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`${this.companyId}: 詳細取得失敗 (${link.externalId}): ${msg}`);
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
}

// ── 企業インスタンス ────────────────────────────────

/** 田辺三菱製薬 */
export const tanabeScraper = new AxolScraper('tanabe', 'mtpc');
