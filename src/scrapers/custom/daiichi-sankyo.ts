/**
 * 第一三共 スクレイパー
 *
 * 第一三共のキャリア採用サイトは Geo-IP 制限があり、
 * 日本国内の IP アドレスからのみアクセス可能。
 * 海外 IP（GitHub Actions のデフォルト等）からは 403 Forbidden を返す。
 *
 * → GitHub Actions では日本リージョンの VPN / プロキシが必要。
 * → ローカル実行（日本国内）では正常に動作する想定。
 *
 * サイトは自社構築の SSR HTML（または i-web 系の ATS）。
 * 求人一覧ページから求人リンクを収集し、詳細ページで情報を補完する。
 *
 * 対象 URL: https://daiichisankyo-recruiting.com/
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from '../base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../../config.js';
import { logger } from '../../utils/logger.js';

export class DaiichiSankyoScraper extends BaseScraper {
  companyId = 'daiichi-sankyo';
  readonly url = 'https://daiichisankyo-recruiting.com/';

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    // Geo-IP 制限チェック
    const pageContent = await page.content();
    if (pageContent.includes('denied') || pageContent.includes('403') || pageContent.includes('Forbidden')) {
      logger.warn(`${this.companyId}: Geo-IP 制限により 403 Forbidden。日本国内の IP が必要です`);
      return [];
    }

    // 求人一覧リンクを収集
    const jobLinks = await page.evaluate((baseUrl: string) => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        department?: string;
        location?: string;
      }> = [];

      // キャリア採用系リンクを広く収集
      const links = document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="job"], a[href*="career"], a[href*="recruit"], ' +
        'a[href*="position"], a[href*="entry"], a[href*="detail"]',
      );

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (link.closest('nav, header, footer')) continue;

        const title = link.textContent?.trim() || '';
        if (!title || title.length < 3) continue;
        if (/トップ|TOP|ホーム|HOME|新卒|ログイン|マイページ/i.test(title)) continue;

        const href = link.href || link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

        // URL パスから ID を推測
        const idMatch = href.match(/(?:id|code|no)=(\w+)/i) || href.match(/\/(\d+)\/?$/);
        const externalId = idMatch?.[1];

        results.push({ title, url: fullUrl, externalId });
      }

      // テーブル/リスト形式の募集情報も収集
      const sections = document.querySelectorAll('section, [class*="section"], [class*="list"]');
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const heading = section.querySelector('h2, h3');
        const headingText = heading?.textContent?.trim() || '';

        const items = section.querySelectorAll('li, tr, [class*="item"], [class*="card"]');
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const itemLink = item.querySelector('a') as HTMLAnchorElement | null;
          const title = itemLink?.textContent?.trim() || item.querySelector('h3, h4, .title')?.textContent?.trim() || '';
          if (!title || title.length < 3) continue;
          if (results.some(r => r.title === title)) continue;

          const href = itemLink?.href || '';
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href || ''}`;

          results.push({
            title,
            url: fullUrl || baseUrl,
            department: headingText || undefined,
          });
        }
      }

      // 重複排除
      const seen = new Set<string>();
      return results.filter(r => {
        if (seen.has(r.title)) return false;
        seen.add(r.title);
        return true;
      });
    }, this.url);

    logger.info(`${this.companyId}: ページから ${jobLinks.length} 件を検出`);

    // 詳細ページがある場合は取得
    const jobs: JobListing[] = [];
    for (const link of jobLinks.slice(0, 50)) {
      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId: link.externalId,
        department: link.department,
        location: link.location,
      };

      // 詳細ページから情報補完（リンク先が自サイト内の場合のみ）
      if (link.url && link.url !== this.url && link.url.includes('daiichisankyo')) {
        let detailPage: Page | null = null;
        try {
          detailPage = await page.context().newPage();
          await detailPage.goto(link.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

          const detail = await detailPage.evaluate((labelSets: Record<string, string[]>) => {
            const result: Record<string, string | undefined> = {};

            for (const [key, labels] of Object.entries(labelSets)) {
              const rows = document.querySelectorAll('tr, dt, th, [class*="label"]');
              for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const text = row.textContent?.trim() || '';
                for (const label of labels) {
                  if (!text.includes(label)) continue;
                  const valueCell = row.querySelector('td:last-child') || row.nextElementSibling;
                  if (valueCell?.textContent?.trim()) {
                    result[key] = valueCell.textContent.trim();
                    break;
                  }
                }
                if (result[key]) break;
              }
            }

            if (!result.description) {
              const main = document.querySelector('main, article, [class*="detail"], [class*="content"]');
              if (main?.textContent?.trim()) result.description = main.textContent.trim().slice(0, 5000);
            }

            return result;
          }, {
            description: ['仕事内容', '職務内容', '業務内容'],
            requirements: ['応募資格', '応募要件', '必須条件'],
            department: ['部門', '部署', '配属先'],
            location: ['勤務地', '就業場所'],
          });

          job.description = detail.description;
          job.requirements = detail.requirements;
          if (detail.department) job.department = detail.department;
          if (detail.location) job.location = detail.location;
        } catch {
          // 詳細取得失敗は無視
        } finally {
          if (detailPage) {
            try { await detailPage.close(); } catch { /* ignore */ }
          }
        }
      }

      const textCat = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(textCat);
      job.therapeuticArea = classifyTherapeuticArea(textCat);

      jobs.push(job);
    }

    return jobs;
  }
}

// ── 第一三共インスタンス ──────────────────────────────
export const daiichiSankyoScraper = new DaiichiSankyoScraper();
