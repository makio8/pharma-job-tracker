/**
 * 住友ファーマ スクレイパー
 *
 * 住友ファーマのキャリア採用サイトは自社構築の SSR HTML サイト。
 * jQuery ベースの静的ページ。
 * キャリア（中途）採用情報は /career/ 以下に掲載。
 *
 * 注意: URL は www.recruit.sumitomo-pharma.co.jp （www 付き必須）
 *
 * 対象 URL: https://www.recruit.sumitomo-pharma.co.jp/career/
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from '../base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../../config.js';
import { logger } from '../../utils/logger.js';

export class SumitomoScraper extends BaseScraper {
  companyId = 'sumitomo';
  readonly url = 'https://www.recruit.sumitomo-pharma.co.jp/career/';

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    // キャリア採用ページから求人情報を収集
    const jobLinks = await page.evaluate((baseUrl: string) => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        department?: string;
        location?: string;
      }> = [];

      // パターン1: 求人リンクを収集
      const links = document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="career"], a[href*="job"], a[href*="position"], ' +
        'a[href*="募集"], a[href*="recruit"]',
      );

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (link.closest('nav, header, footer')) continue;

        const title = link.textContent?.trim() || '';
        if (!title || title.length < 3) continue;
        if (/トップ|TOP|ホーム|HOME|会社概要|新卒|インターン/i.test(title)) continue;

        const href = link.href || link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

        results.push({ title, url: fullUrl });
      }

      // パターン2: セクション見出し + リスト形式の募集情報
      const sections = document.querySelectorAll('section, [class*="section"], [class*="content"]');
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const heading = section.querySelector('h1, h2, h3');
        if (!heading) continue;

        const headingText = heading.textContent?.trim() || '';

        // 募集情報テーブルを探す
        const tables = section.querySelectorAll('table');
        for (let t = 0; t < tables.length; t++) {
          const table = tables[t];
          const rows = table.querySelectorAll('tr');

          let currentDept = headingText;
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const cells = row.querySelectorAll('th, td');
            if (cells.length < 2) continue;

            const label = cells[0]?.textContent?.trim() || '';
            const value = cells[1]?.textContent?.trim() || '';

            if (label.includes('職種') || label.includes('ポジション')) {
              if (value && !results.some(x => x.title === value)) {
                results.push({
                  title: value,
                  url: baseUrl,
                  department: currentDept,
                });
              }
            } else if (label.includes('部門') || label.includes('部署')) {
              currentDept = value;
            }
          }
        }

        // リスト項目からも取得
        const items = section.querySelectorAll('li, dd');
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const text = item.textContent?.trim() || '';
          if (!text || text.length < 5) continue;
          if (results.some(x => x.title === text)) continue;

          // 求人っぽいテキストかチェック
          if (/MR|研究|開発|製造|品質|営業|臨床|メディカル|薬事|DX|デジタル|エンジニア|マネージャー|スペシャリスト/i.test(text)) {
            const itemLink = item.querySelector('a') as HTMLAnchorElement | null;
            results.push({
              title: text.slice(0, 200),
              url: itemLink?.href || baseUrl,
              department: headingText,
            });
          }
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

    // ページ全体の募集要項テキストを description として取得
    const pageDescription = await page.evaluate(() => {
      const main = document.querySelector('main, #main, [class*="content"], article, body');
      if (!main) return null;
      const clone = main.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('nav, header, footer, script, style, [class*="nav"], [class*="footer"]').forEach(el => el.remove());
      const text = clone.textContent?.trim();
      return text && text.length > 100 ? text.slice(0, 5000) : null;
    });

    // JobListing に変換して分類
    const jobs: JobListing[] = [];
    for (const link of jobLinks) {
      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId: link.externalId,
        department: link.department,
        location: link.location,
      };

      // リンク先が異なるページなら個別取得、同じなら一覧ページの本文を使う
      if (link.url && link.url !== this.url && link.url.includes('sumitomo-pharma')) {
        let detailPage: Page | null = null;
        try {
          detailPage = await page.context().newPage();
          await detailPage.goto(link.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

          const detail = await detailPage.evaluate(() => {
            const main = document.querySelector('main, #main, [class*="content"], article');
            if (!main) return { description: null };
            const clone = main.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('nav, header, footer, script, style').forEach(el => el.remove());
            const text = clone.textContent?.trim();
            return { description: text && text.length > 50 ? text.slice(0, 5000) : null };
          });

          if (detail.description) {
            job.description = detail.description;
            logger.info(`${this.companyId}: 詳細取得成功 - ${link.title.slice(0, 30)}`);
          }
        } catch {
          // フォールバック: 一覧ページの本文を使う
          if (pageDescription) job.description = pageDescription;
        } finally {
          if (detailPage) { try { await detailPage.close(); } catch { /* ignore */ } }
        }
      } else if (pageDescription) {
        // 同じページ内の求人は一覧ページの本文をdescriptionに
        job.description = pageDescription;
      }

      const textCat = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(textCat);
      job.therapeuticArea = classifyTherapeuticArea(`${job.title} ${job.description ?? ''}`);

      jobs.push(job);
    }

    return jobs;
  }
}

// ── 住友ファーマインスタンス ──────────────────────────────
export const sumitomoScraper = new SumitomoScraper();
