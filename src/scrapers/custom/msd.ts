/**
 * MSD Japan スクレイパー
 *
 * MSD（Merck Sharp & Dohme）の日本法人キャリアページからスクレイピング。
 * SPA（JavaScript レンダリング）の可能性が高いため、
 * Playwright で動的コンテンツの読み込みを待つ。
 *
 * 対象 URL: https://jobs.msd.com/jpn-careers-ja
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from '../base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../../config.js';
import { logger } from '../../utils/logger.js';

export class MsdScraper extends BaseScraper {
  companyId = 'msd';
  readonly url = 'https://jobs.msd.com/jpn-careers-ja';

  /** 詳細ページを取得する上限 */
  private readonly detailLimit = 50;

  async extractJobs(page: Page): Promise<JobListing[]> {
    // MSD のキャリアサイトは JS レンダリングのため十分な待機が必要
    await page.waitForLoadState('networkidle');

    // 求人カードやリストが表示されるまで待つ（複数パターンに対応）
    try {
      await page.waitForSelector(
        '[class*="job"], [class*="career"], [class*="position"], [class*="opening"], ' +
        '[data-job], [data-testid*="job"], .search-results, .results-list',
        { timeout: 15_000 },
      );
    } catch {
      logger.warn('msd: 求人リスト要素の検出待ちタイムアウト。ページ構造を走査します');
    }

    // ── 「もっと見る」/「Load More」ボタンの自動クリック ──
    // MSD のサイトはページネーションまたは Load More を使う可能性がある
    await this.loadAllJobs(page);

    // ── 一覧から求人情報を抽出 ──
    const jobLinks = await page.evaluate(() => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        department?: string;
        location?: string;
      }> = [];

      // パターン1: 求人カード / リストアイテム
      const cards = document.querySelectorAll(
        '[class*="job-card"], [class*="job-item"], [class*="JobCard"], ' +
        '[class*="position-card"], [class*="search-result"], ' +
        '[class*="career-card"], [class*="opening"], ' +
        'li[class*="job"], article[class*="job"]'
      );

      if (cards.length > 0) {
        for (const card of cards) {
          const link = card.querySelector('a[href]') as HTMLAnchorElement | null;
          const titleEl =
            card.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]') ||
            link;

          const title = titleEl?.textContent?.trim() || '';
          if (!title) continue;

          const href = link?.href || '';

          let externalId: string | undefined;
          // data 属性から ID を取得
          externalId =
            card.getAttribute('data-job-id') ||
            card.getAttribute('data-id') ||
            card.getAttribute('data-requisition-id') ||
            undefined;
          // URL から ID を抽出
          if (!externalId && href) {
            try {
              const url = new URL(href);
              externalId =
                url.searchParams.get('jobId') ||
                url.searchParams.get('id') ||
                url.pathname.match(/\/(\d+)/)?.[1];
            } catch {
              // pass
            }
          }

          const deptEl = card.querySelector(
            '[class*="department"], [class*="category"], [class*="function"]'
          );
          const locEl = card.querySelector(
            '[class*="location"], [class*="city"], [class*="country"]'
          );

          results.push({
            title,
            url: href,
            externalId,
            department: deptEl?.textContent?.trim(),
            location: locEl?.textContent?.trim(),
          });
        }
      }

      // パターン2: テーブル形式
      if (results.length === 0) {
        const rows = document.querySelectorAll('table tbody tr, .results-table tr');
        for (const row of rows) {
          const link = row.querySelector('a[href]') as HTMLAnchorElement | null;
          if (!link) continue;

          const title = link.textContent?.trim() || '';
          if (!title) continue;

          const cells = row.querySelectorAll('td');
          const department = cells.length >= 2 ? cells[1]?.textContent?.trim() : undefined;
          const location = cells.length >= 3 ? cells[2]?.textContent?.trim() : undefined;

          let externalId: string | undefined;
          try {
            const url = new URL(link.href);
            externalId =
              url.searchParams.get('jobId') ||
              url.searchParams.get('id') ||
              url.pathname.match(/\/(\d+)/)?.[1];
          } catch {
            // pass
          }

          results.push({
            title,
            url: link.href,
            externalId,
            department,
            location,
          });
        }
      }

      // パターン3: 汎用リンク収集
      if (results.length === 0) {
        const allLinks = document.querySelectorAll(
          'a[href*="job"], a[href*="position"], a[href*="requisition"], a[href*="career"]'
        );
        for (const el of allLinks) {
          const link = el as HTMLAnchorElement;
          const title = link.textContent?.trim() || '';
          if (!title || title.length < 5) continue;
          // ナビゲーションリンクを除外
          if (link.closest('nav, header, footer')) continue;

          let externalId: string | undefined;
          try {
            const url = new URL(link.href);
            externalId =
              url.searchParams.get('jobId') ||
              url.searchParams.get('id') ||
              url.pathname.match(/\/(\d+)/)?.[1];
          } catch {
            // pass
          }

          results.push({ title, url: link.href, externalId });
        }
      }

      return results;
    });

    logger.info(`msd: 一覧ページから ${jobLinks.length} 件のリンクを検出`);

    if (jobLinks.length === 0) {
      logger.warn('msd: 求人リンクが見つかりません。ページ構造が変わった可能性があります');
      return [];
    }

    // ── 詳細ページを巡回 ──
    const jobs: JobListing[] = [];
    const targetLinks = jobLinks.slice(0, this.detailLimit);

    for (const link of targetLinks) {
      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId: link.externalId,
        department: link.department,
        location: link.location,
      };

      // 詳細ページからテキストを取得
      if (link.url) {
        try {
          await page.goto(link.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
          await page.waitForLoadState('networkidle').catch(() => {});

          const detail = await page.evaluate(() => {
            // セクション見出し + 本文のパターンで探索
            const findSection = (labels: string[]): string | undefined => {
              // 見出し要素から探す
              const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, strong, dt, th'));
              for (const heading of headings) {
                const text = heading.textContent?.trim() || '';
                for (const label of labels) {
                  if (text.includes(label)) {
                    // 次の兄弟要素、または親のテキストを取得
                    // dd パターン
                    if ((heading as Element).tagName === 'DT') {
                      const dd = heading.nextElementSibling;
                      if (dd && (dd as Element).tagName === 'DD') return dd.textContent?.trim() ?? undefined;
                    }
                    // 通常パターン: 次の兄弟要素のテキストを取得
                    const sibling = heading.nextElementSibling;
                    if (sibling) return sibling.textContent?.trim() ?? undefined;
                  }
                }
              }
              return undefined;
            };

            // class ベースでの取得
            const getByClass = (patterns: string[]): string | undefined => {
              for (const pattern of patterns) {
                const el = document.querySelector(`[class*="${pattern}"]`);
                if (el?.textContent?.trim()) return el.textContent.trim();
              }
              return undefined;
            };

            const description =
              findSection(['Job Description', '職務内容', '仕事内容', '業務内容', 'Responsibilities']) ||
              getByClass(['description', 'job-detail', 'job-body']);

            const requirements =
              findSection(['Qualifications', '応募資格', '必須条件', 'Requirements', '求める人材']) ||
              getByClass(['requirements', 'qualifications']);

            const department =
              findSection(['Department', '部門', 'Function', '職種']) ||
              getByClass(['department', 'function']);

            const location =
              findSection(['Location', '勤務地', '就業場所']) ||
              getByClass(['location', 'city']);

            return { description, requirements, department, location };
          });

          job.description = detail.description;
          job.requirements = detail.requirements;
          if (!job.department && detail.department) job.department = detail.department;
          if (!job.location && detail.location) job.location = detail.location;
        } catch {
          logger.warn(`msd: 詳細ページ取得失敗 - ${link.url}`);
        }
      }

      // 自動分類
      const textForClassify = `${job.title} ${job.description ?? ''}`;
      job.jobCategory = classifyJobCategory(textForClassify);
      job.therapeuticArea = classifyTherapeuticArea(textForClassify);

      jobs.push(job);
    }

    return jobs;
  }

  /**
   * 「もっと見る」ボタンを繰り返しクリックして全求人を表示する
   * 最大10回クリックで打ち切り
   */
  private async loadAllJobs(page: Page): Promise<void> {
    const maxClicks = 10;

    for (let i = 0; i < maxClicks; i++) {
      const loadMoreBtn = await page.$(
        'button:has-text("Load More"), button:has-text("もっと見る"), ' +
        'button:has-text("Show More"), a:has-text("次のページ"), ' +
        '[class*="load-more"], [class*="show-more"], [class*="pagination"] a:last-child'
      );

      if (!loadMoreBtn) break;

      const isVisible = await loadMoreBtn.isVisible().catch(() => false);
      if (!isVisible) break;

      try {
        await loadMoreBtn.click();
        // クリック後にコンテンツが読み込まれるのを待つ
        await page.waitForTimeout(2_000);
        await page.waitForLoadState('networkidle').catch(() => {});
      } catch {
        break;
      }
    }
  }
}

// ── MSD インスタンス ──────────────────────────────

export const msdScraper = new MsdScraper();
