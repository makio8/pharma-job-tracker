/**
 * Attrax (Clinch) キャリアページ用スクレイパー
 *
 * Attrax は採用マーケティングプラットフォーム（CMS）。
 * サーバーサイドレンダリング（SSR）で求人一覧が HTML に含まれる。
 * 求人カードは `div.attrax-vacancy-tile` で、`data-jobid` 属性に求人IDが含まれる。
 * ページネーションは `?page=N` パラメータ。
 *
 * 対応企業: AbbVie（アッヴィ）
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

export class AttraxScraper extends BaseScraper {
  companyId: string;
  readonly url: string;
  private baseUrl: string;

  /** 最大ページ数 */
  private readonly maxPages = 20;

  /**
   * @param companyId - 内部企業ID
   * @param siteUrl   - Attrax サイトの URL（例: 'https://careers.abbvie.com'）
   * @param searchQuery - Japan 求人検索クエリ（例: 'japan'）
   */
  constructor(companyId: string, siteUrl: string, searchQuery: string = 'japan') {
    super();
    this.companyId = companyId;
    this.baseUrl = siteUrl;
    this.url = `${siteUrl}/en/jobs?q=${searchQuery}&page=1`;
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    const allJobs: JobListing[] = [];

    // 1ページ目を抽出
    const firstPageJobs = await this.extractJobsFromPage(page);
    allJobs.push(...firstPageJobs);
    logger.info(`${this.companyId}: 1ページ目 ${firstPageJobs.length} 件`);

    if (firstPageJobs.length === 0) {
      return [];
    }

    // ページネーション
    for (let pageNum = 2; pageNum <= this.maxPages; pageNum++) {
      let nextPage: Page | null = null;
      try {
        const pageUrl = this.url.replace('page=1', `page=${pageNum}`);
        nextPage = await page.context().newPage();
        await nextPage.goto(pageUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });

        const pageJobs = await this.extractJobsFromPage(nextPage);
        if (pageJobs.length === 0) break;

        allJobs.push(...pageJobs);
        logger.info(`${this.companyId}: ページ ${pageNum} - ${pageJobs.length} 件（累計 ${allJobs.length} 件）`);
      } catch {
        break;
      } finally {
        if (nextPage) {
          try { await nextPage.close(); } catch { /* ignore */ }
        }
      }
    }

    // 詳細ページから description を取得
    const jobs: JobListing[] = [];
    for (const job of allJobs.slice(0, 50)) {
      if (job.url) {
        let detailPage: Page | null = null;
        try {
          detailPage = await page.context().newPage();
          await detailPage.goto(job.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

          const detail = await detailPage.evaluate((labelSets: Record<string, string[]>) => {
            const result: Record<string, string | undefined> = {};

            // Attrax の詳細ページは .attrax-vacancy-detail セクション
            for (const [key, labels] of Object.entries(labelSets)) {
              const sections = document.querySelectorAll('[class*="section"], [class*="detail"], h2, h3');
              for (let i = 0; i < sections.length; i++) {
                const heading = sections[i];
                const headingText = heading.textContent?.trim() || '';
                for (const label of labels) {
                  if (!headingText.includes(label)) continue;

                  // 次の要素からテキストを取得
                  let content = '';
                  let next = heading.nextElementSibling;
                  while (next && !['H2', 'H3'].includes(next.tagName)) {
                    content += (next.textContent?.trim() || '') + '\n';
                    next = next.nextElementSibling;
                  }
                  if (content.trim()) {
                    result[key] = content.trim();
                    break;
                  }
                }
                if (result[key]) break;
              }
            }

            // フォールバック: 本文全体
            if (!result.description) {
              const main = document.querySelector(
                '.attrax-vacancy-detail, [class*="vacancy-detail"], [class*="job-detail"], main, article',
              );
              if (main?.textContent?.trim()) {
                result.description = main.textContent.trim().slice(0, 5000);
              }
            }

            return result;
          }, {
            description: ['Job Description', 'Description', 'Responsibilities', '仕事内容', '職務内容'],
            requirements: ['Qualifications', 'Requirements', 'What you need', '応募資格', '必須条件'],
          });

          job.description = detail.description;
          job.requirements = detail.requirements;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(`${this.companyId}: 詳細取得失敗 (${job.externalId}): ${msg}`);
        } finally {
          if (detailPage) {
            try { await detailPage.close(); } catch { /* ignore */ }
          }
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

  /** 1ページ分の求人をDOMから抽出 */
  private async extractJobsFromPage(p: Page): Promise<JobListing[]> {
    return p.evaluate((baseUrl: string) => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        location?: string;
        department?: string;
      }> = [];

      // Attrax の求人カード
      const tiles = document.querySelectorAll(
        '.attrax-vacancy-tile, [class*="vacancy-tile"], [class*="job-card"]',
      );

      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];

        // 求人ID
        const jobId = (tile as HTMLElement).getAttribute('data-jobid') || '';

        // タイトル & URL
        const linkEl = tile.querySelector('a[href*="/job/"]') as HTMLAnchorElement | null;
        if (!linkEl) continue;

        const title = linkEl.textContent?.trim() || '';
        if (!title || title.length < 3) continue;

        const href = linkEl.href || linkEl.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

        // ラベル→値のペアからメタ情報取得
        const labels = tile.querySelectorAll('[class*="label"]');
        const values = tile.querySelectorAll('[class*="value"]');

        let location: string | undefined;
        let department: string | undefined;

        for (let j = 0; j < labels.length; j++) {
          const labelText = labels[j]?.textContent?.trim()?.toLowerCase() || '';
          const valueText = values[j]?.textContent?.trim();
          if (!valueText) continue;

          if (labelText.includes('location') || labelText.includes('勤務地')) {
            location = valueText;
          } else if (labelText.includes('department') || labelText.includes('部門') || labelText.includes('function')) {
            department = valueText;
          }
        }

        // external_id: data-jobid or URL から抽出
        let externalId = jobId || undefined;
        if (!externalId) {
          const idMatch = href.match(/jid-(\d+)/);
          externalId = idMatch?.[1];
        }

        results.push({ title, url: fullUrl, externalId, location, department });
      }

      // フォールバック: タイルが見つからない場合は汎用リンク収集
      if (results.length === 0) {
        const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/job/"]');
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          if (link.closest('nav, header, footer')) continue;

          const title = link.textContent?.trim() || '';
          if (!title || title.length < 5) continue;

          const href = link.href;
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          const idMatch = href.match(/jid-(\d+)/);

          results.push({ title, url: fullUrl, externalId: idMatch?.[1] });
        }
      }

      return results;
    }, this.baseUrl);
  }
}

// ── 企業インスタンス ────────────────────────────────

/** AbbVie（アッヴィ） */
export const abbvieScraper = new AttraxScraper(
  'abbvie',
  'https://careers.abbvie.com',
  'japan',
);
