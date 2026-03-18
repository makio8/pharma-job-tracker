/**
 * Radancy / TalentBrew キャリアページ用スクレイパー
 *
 * Radancy（旧 TMP Worldwide）は求人サイト構築プラットフォーム。
 * TalentBrew は Radancy のブランド名。
 * サーバーサイドレンダリング + JS で求人を表示する。
 *
 * URL 構造: /search-jobs/{location}/{companyId}/{facets}/{geoId}/{lat}/{lng}/{radius}/{page}
 * 各求人はリンク付きカードで表示される。
 *
 * 対応企業:
 *   - アストラゼネカ (companyId: 7684)
 *   - サノフィ (companyId: 2649)
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

export class RadancyScraper extends BaseScraper {
  companyId: string;
  readonly url: string;

  /** 最大ページ数（ページネーション） */
  private readonly maxPages = 10;

  /**
   * @param companyId   - 内部企業ID
   * @param baseUrl     - Radancy サイトのベース URL（例: 'https://careers.astrazeneca.com'）
   * @param searchPath  - Japan 求人の検索パス（例: '/search-jobs/Japan/7684/1/2/...'）
   */
  constructor(companyId: string, baseUrl: string, searchPath: string) {
    super();
    this.companyId = companyId;
    this.url = `${baseUrl}${searchPath}`;
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    const allJobs: JobListing[] = [];

    // 1ページ目から求人を抽出
    const firstPageJobs = await this.extractJobsFromPage(page);
    allJobs.push(...firstPageJobs);
    logger.info(`${this.companyId}: 1ページ目 ${firstPageJobs.length} 件`);

    if (firstPageJobs.length === 0) {
      return [];
    }

    // ページネーション: 「次のページ」リンクを探して巡回
    for (let pageNum = 2; pageNum <= this.maxPages; pageNum++) {
      const nextLink = await page.$('a.pagination-next, a[aria-label="Next"], a.next, [class*="pagination"] a:last-child');
      if (!nextLink) break;

      const isVisible = await nextLink.isVisible().catch(() => false);
      if (!isVisible) break;

      const href = await nextLink.getAttribute('href');
      if (!href) break;

      try {
        const nextUrl = href.startsWith('http') ? href : new URL(href, this.url).toString();
        const nextPage = await page.context().newPage();
        try {
          await nextPage.goto(nextUrl, { timeout: 20_000, waitUntil: 'domcontentloaded' });
          const pageJobs = await this.extractJobsFromPage(nextPage);

          if (pageJobs.length === 0) break;

          allJobs.push(...pageJobs);
          logger.info(`${this.companyId}: ページ ${pageNum} - ${pageJobs.length} 件（累計 ${allJobs.length} 件）`);
        } finally {
          try { await nextPage.close(); } catch { /* ignore */ }
        }
      } catch {
        break;
      }
    }

    // 詳細ページから description を取得
    await this.enrichWithDetails(page, allJobs);

    // 自動分類
    return allJobs.map((job) => {
      const text = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(text);
      job.therapeuticArea = classifyTherapeuticArea(`${job.title} ${job.description ?? ''}`);
      return job;
    });
  }

  /** 各求人の詳細ページを開いて description / requirements を取得 */
  private async enrichWithDetails(page: Page, jobs: JobListing[]): Promise<void> {
    const DETAIL_LIMIT = 50;
    const toEnrich = jobs.filter(j => j.url).slice(0, DETAIL_LIMIT);

    for (const job of toEnrich) {
      let detailPage: Page | null = null;
      try {
        detailPage = await page.context().newPage();
        await detailPage.goto(job.url!, { timeout: 15_000, waitUntil: 'domcontentloaded' });
        await detailPage.waitForTimeout(1_000);

        const detail = await detailPage.evaluate(() => {
          // Radancy/TalentBrew の詳細ページから募集要項を抽出
          const desc: string[] = [];
          const req: string[] = [];

          // Strategy 0: JSON-LD (Schema.org JobPosting) — 最も信頼性が高い
          const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (let i = 0; i < jsonLdScripts.length; i++) {
            try {
              const data = JSON.parse(jsonLdScripts[i].textContent || '');
              const posting = data['@type'] === 'JobPosting' ? data : null;
              if (posting?.description) {
                // HTML タグを除去
                const tmp = document.createElement('div');
                tmp.innerHTML = posting.description;
                desc.push(tmp.textContent?.trim() || '');
              }
              if (posting?.qualifications) {
                const tmp = document.createElement('div');
                tmp.innerHTML = posting.qualifications;
                req.push(tmp.textContent?.trim() || '');
              }
            } catch { /* ignore parse errors */ }
          }

          // Strategy 1: jtbd- prefixed sections (TalentBrew standard)
          if (desc.length === 0) {
            const descSection = document.querySelector(
              '[class*="jtbd-description"], [class*="job-description"], [class*="jd-info"], #job-description, .job-detail'
            );
            if (descSection?.textContent?.trim()) {
              desc.push(descSection.textContent.trim());
            }
          }

          if (req.length === 0) {
            const reqSection = document.querySelector(
              '[class*="jtbd-qualification"], [class*="qualification"], [class*="requirement"]'
            );
            if (reqSection?.textContent?.trim()) {
              req.push(reqSection.textContent.trim());
            }
          }

          // Strategy 2: Main content area fallback
          if (desc.length === 0) {
            const main = document.querySelector('main, article, [role="main"], .content-area, #content');
            if (main?.textContent?.trim()) {
              const clone = main.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('nav, header, footer, [class*="nav"], [class*="footer"], [class*="apply"], button, form').forEach(el => el.remove());
              const text = clone.textContent?.trim();
              if (text && text.length > 100) {
                desc.push(text);
              }
            }
          }

          return {
            description: desc.join('\n\n').slice(0, 5000) || null,
            requirements: req.join('\n\n').slice(0, 3000) || null,
          };
        });

        if (detail.description) {
          job.description = detail.description;
        }
        if (detail.requirements) {
          job.requirements = detail.requirements;
        }

        logger.info(`${this.companyId}: 詳細取得成功 - ${job.externalId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`${this.companyId}: 詳細取得失敗 (${job.externalId}): ${msg}`);
      } finally {
        if (detailPage) {
          try { await detailPage.close(); } catch { /* ignore */ }
        }
      }
    }
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

      // Radancy/TalentBrew の求人リンクは /job/ パスを含む
      const jobLinks = document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="/job/"], a[href*="/jobs/"]',
      );

      for (let i = 0; i < jobLinks.length; i++) {
        const link = jobLinks[i];
        // ナビゲーション・フッター内のリンクは除外
        if (link.closest('nav, header, footer, [class*="nav"], [class*="footer"]')) continue;

        const title = link.textContent?.trim() || '';
        if (!title || title.length < 5) continue;
        // UIテキストを除外
        if (/search|view all|see all|apply|sign|login|register/i.test(title)) continue;

        const href = link.href || link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

        // external_id を URL パスから抽出（末尾の数値）
        const idMatch = href.match(/\/(\d+)\/?$/);
        const externalId = idMatch?.[1];

        // 親要素からメタ情報を取得
        const card = link.closest('li, article, [class*="card"], [class*="item"], tr') || link.parentElement;

        const locEl = card?.querySelector(
          '[class*="location"], [class*="city"], [class*="Location"], span[class*="loc"]',
        );
        const location = locEl?.textContent?.trim();

        const deptEl = card?.querySelector(
          '[class*="department"], [class*="category"], [class*="function"]',
        );
        const department = deptEl?.textContent?.trim();

        results.push({ title, url: fullUrl, externalId, location, department });
      }

      // 重複排除（同じ URL のリンクが複数あることがある）
      const seen = new Set<string>();
      return results.filter((r) => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      });
    }, this.url.replace(/\/search-jobs\/.*/, ''));
  }
}

// ── 企業インスタンス ────────────────────────────────

/** アストラゼネカ（TalentBrew, companyId: 7684） */
export const astrazenecaScraper = new RadancyScraper(
  'astrazeneca',
  'https://careers.astrazeneca.com',
  '/search-jobs/Japan/7684/1',
);

/** サノフィ（Radancy, companyId: 2649） */
export const sanofiScraper = new RadancyScraper(
  'sanofi',
  'https://jobs.sanofi.com',
  '/en/search-jobs/japan/2649/1',
);
