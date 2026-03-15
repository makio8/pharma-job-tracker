/**
 * 小野薬品工業 スクレイパー
 *
 * 小野薬品のキャリア採用サイトは自社構築の SSR HTML サイト。
 * jQuery + GSAP ベースの静的ページ。
 * キャリア採用（中途）の求人はサブページに掲載されている。
 *
 * 新卒エントリーは i-webs（外部ATS）に飛ぶが、
 * キャリア採用情報は自社サイト内に掲載。
 *
 * 対象 URL: https://recruit.ono-pharma.com/career/
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from '../base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../../config.js';
import { logger } from '../../utils/logger.js';

export class OnoScraper extends BaseScraper {
  companyId = 'ono';
  readonly url = 'https://recruit.ono-pharma.com/career/';

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');

    // キャリア採用ページからリンクを収集
    const jobLinks = await page.evaluate((baseUrl: string) => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        department?: string;
        location?: string;
      }> = [];

      // キャリア採用ページの求人リンクを収集
      // パターン1: セクション別の募集情報リンク
      const links = document.querySelectorAll<HTMLAnchorElement>(
        'a[href*="career"], a[href*="recruitment"], a[href*="job"], ' +
        'a[href*="about/"], a[href*="募集"]',
      );

      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (link.closest('nav, header, footer, .l-header, .l-gnav')) continue;

        const title = link.textContent?.trim() || '';
        if (!title || title.length < 3) continue;
        // ナビゲーション系を除外
        if (/トップ|TOP|ホーム|HOME|会社概要|エントリー|マイページ|新卒/i.test(title)) continue;

        const href = link.href || link.getAttribute('href') || '';
        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

        // URLパスから簡易IDを生成
        const pathParts = href.replace(baseUrl, '').split('/').filter(Boolean);
        const externalId = pathParts.join('-') || undefined;

        results.push({ title, url: fullUrl, externalId });
      }

      // パターン2: 募集情報セクション内のテキストブロック
      const sections = document.querySelectorAll(
        '[id*="recruitment"], [class*="recruitment"], [class*="recruit"], ' +
        'section, .c-section, [class*="job"]',
      );

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const heading = section.querySelector('h2, h3, h4');
        if (!heading) continue;

        const headingText = heading.textContent?.trim() || '';
        if (!headingText.includes('募集') && !headingText.includes('採用') && !headingText.includes('求人')) continue;

        // セクション内のリスト項目を求人として取得
        const items = section.querySelectorAll('li, dt, .item');
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          const itemLink = item.querySelector('a') as HTMLAnchorElement | null;
          const itemTitle = itemLink?.textContent?.trim() || item.textContent?.trim() || '';
          if (!itemTitle || itemTitle.length < 3) continue;
          if (results.some(r => r.title === itemTitle)) continue; // 重複排除

          const itemHref = itemLink?.href || '';
          const itemUrl = itemHref.startsWith('http') ? itemHref : `${baseUrl}${itemHref || ''}`;

          results.push({
            title: itemTitle,
            url: itemUrl || baseUrl,
            department: headingText,
          });
        }
      }

      // 重複排除
      const seen = new Set<string>();
      return results.filter(r => {
        const key = r.title;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }, this.url);

    logger.info(`${this.companyId}: ページから ${jobLinks.length} 件のリンクを検出`);

    // サブページも巡回して募集情報を取得
    const subPages = [
      'https://recruit.ono-pharma.com/about/medical-representative/',
      'https://recruit.ono-pharma.com/about/production/',
    ];

    for (const subUrl of subPages) {
      let subPage: Page | null = null;
      try {
        subPage = await page.context().newPage();
        await subPage.goto(subUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });

        const subJobs = await subPage.evaluate((url: string) => {
          const results: Array<{
            title: string;
            url: string;
            department?: string;
          }> = [];

          // 募集情報セクションを探す
          const recruitSection = document.querySelector(
            '[id*="recruitment"], [class*="recruitment"]',
          );
          if (!recruitSection) return results;

          const headings = recruitSection.querySelectorAll('h3, h4, dt');
          for (let i = 0; i < headings.length; i++) {
            const h = headings[i];
            const title = h.textContent?.trim() || '';
            if (!title || title.length < 3) continue;

            results.push({ title, url, department: title });
          }

          return results;
        }, subUrl);

        for (const sj of subJobs) {
          if (!jobLinks.some(j => j.title === sj.title)) {
            jobLinks.push({ ...sj, externalId: undefined });
          }
        }
      } catch {
        // サブページ取得失敗は無視
      } finally {
        if (subPage) {
          try { await subPage.close(); } catch { /* ignore */ }
        }
      }
    }

    // JobListing に変換して分類
    return jobLinks.map((link) => {
      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId: link.externalId,
        department: link.department,
        location: link.location,
      };

      const textCat = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(textCat);
      job.therapeuticArea = classifyTherapeuticArea(textCat);

      return job;
    });
  }
}

// ── 小野薬品インスタンス ──────────────────────────────
export const onoScraper = new OnoScraper();
