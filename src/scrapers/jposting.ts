/**
 * JPOSTING スクレイパー
 *
 * JPOSTING は日本の採用管理システム（ATS）。
 * サーバーサイドレンダリングで求人一覧がテーブル / リスト形式で表示される。
 *
 * 対応企業: 中外製薬（chugai）
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

// ── JPOSTING 汎用スクレイパー ────────────────────

export class JpostingScraper extends BaseScraper {
  companyId: string;
  readonly url: string;

  /** 詳細ページを取得する上限（速度のため） */
  private readonly detailLimit = 50;

  constructor(companyId: string, jpostingUrl: string) {
    super();
    this.companyId = companyId;
    this.url = jpostingUrl;
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    // JPOSTING は SSR なのでページ読み込み完了を待つ
    await page.waitForLoadState('domcontentloaded');

    // ── 一覧ページから求人リンクを収集 ──
    // JPOSTING は典型的にテーブル or div リストで求人を表示する
    // 複数のセレクタパターンを試行して対応する
    const jobLinks = await page.evaluate(() => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        department?: string;
        location?: string;
      }> = [];

      // パターン1: テーブル行（tr > td にタイトルとリンク）
      const tableRows = document.querySelectorAll('table tr, .job-list tr');
      if (tableRows.length > 1) {
        // ヘッダー行をスキップ
        for (let i = 0; i < tableRows.length; i++) {
          const row = tableRows[i];
          const link = row.querySelector('a[href]') as HTMLAnchorElement | null;
          if (!link) continue;

          const cells = row.querySelectorAll('td');
          if (cells.length === 0) continue; // ヘッダー行

          const title = link.textContent?.trim() || '';
          if (!title) continue;

          const href = link.href;

          // external_id を URL パラメータから抽出
          let externalId: string | undefined;
          try {
            const url = new URL(href);
            externalId =
              url.searchParams.get('job_id') ||
              url.searchParams.get('id') ||
              url.pathname.split('/').filter(Boolean).pop();
          } catch {
            // URL パースに失敗しても続行
          }

          // 部門・勤務地はテーブルのセル順序に依存
          const department = cells.length >= 2 ? cells[1]?.textContent?.trim() : undefined;
          const location = cells.length >= 3 ? cells[2]?.textContent?.trim() : undefined;

          results.push({ title, url: href, externalId, department, location });
        }
      }

      // パターン2: div/li ベースのリスト
      if (results.length === 0) {
        const listItems = document.querySelectorAll(
          '.job-item, .job-list-item, .recruit-list li, .job_list li, ' +
          '[class*="job"] li, [class*="recruit"] li, .entry-list li, ' +
          '.search-result li, .result-list li'
        );

        for (const item of listItems) {
          const link = item.querySelector('a[href]') as HTMLAnchorElement | null;
          if (!link) continue;

          const title = link.textContent?.trim() || '';
          if (!title) continue;

          const href = link.href;
          let externalId: string | undefined;
          try {
            const url = new URL(href);
            externalId =
              url.searchParams.get('job_id') ||
              url.searchParams.get('id') ||
              url.pathname.split('/').filter(Boolean).pop();
          } catch {
            // pass
          }

          // 部門・勤務地は隣接要素から推測
          const dept = item.querySelector('[class*="dept"], [class*="category"], [class*="division"]');
          const loc = item.querySelector('[class*="area"], [class*="location"], [class*="place"]');

          results.push({
            title,
            url: href,
            externalId,
            department: dept?.textContent?.trim(),
            location: loc?.textContent?.trim(),
          });
        }
      }

      // パターン3: 汎用リンク収集（フォールバック）
      if (results.length === 0) {
        const allLinks = document.querySelectorAll('a[href*="job"], a[href*="detail"], a[href*="entry"]');
        for (const el of allLinks) {
          const link = el as HTMLAnchorElement;
          const title = link.textContent?.trim() || '';
          if (!title || title.length < 5) continue; // 短すぎるリンクテキストはスキップ

          let externalId: string | undefined;
          try {
            const url = new URL(link.href);
            externalId =
              url.searchParams.get('job_id') ||
              url.searchParams.get('id') ||
              url.pathname.split('/').filter(Boolean).pop();
          } catch {
            // pass
          }

          results.push({ title, url: link.href, externalId });
        }
      }

      return results;
    });

    logger.info(`${this.companyId}: 一覧ページから ${jobLinks.length} 件のリンクを検出`);

    if (jobLinks.length === 0) {
      logger.warn(`${this.companyId}: 求人リンクが見つかりません。ページ構造が変わった可能性があります`);
      return [];
    }

    // ── 詳細ページを巡回して description / requirements を取得 ──
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
      try {
        await page.goto(link.url, { timeout: 15_000, waitUntil: 'domcontentloaded' });

        const detail = await page.evaluate(() => {
          // JPOSTING 詳細ページの典型的な構造:
          // テーブル形式（項目名: 値）or セクション形式
          const getText = (selectors: string[]): string | undefined => {
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el?.textContent?.trim()) return el.textContent.trim();
            }
            return undefined;
          };

          // テーブル行から項目名で値を探す
          const findTableValue = (labels: string[]): string | undefined => {
            const rows = document.querySelectorAll('tr, dt, th');
            for (const row of rows) {
              const text = row.textContent?.trim() || '';
              for (const label of labels) {
                if (text.includes(label)) {
                  // 隣接セル(td)や次の要素(dd)を取得
                  const valueCell =
                    row.querySelector('td:last-child') ||
                    row.nextElementSibling;
                  if (valueCell) return valueCell.textContent?.trim();
                }
              }
            }
            return undefined;
          };

          const description =
            findTableValue(['仕事内容', '職務内容', '業務内容', '募集内容']) ||
            getText(['.job-description', '.description', '[class*="detail"]']);

          const requirements =
            findTableValue(['応募資格', '必須条件', '必要なスキル', '応募要件', '求める人材']) ||
            getText(['.requirements', '.qualifications', '[class*="require"]']);

          const department =
            findTableValue(['部門', '部署', '配属先', '所属']) ||
            getText(['.department', '[class*="dept"]']);

          const location =
            findTableValue(['勤務地', '就業場所', '勤務場所']) ||
            getText(['.location', '[class*="location"]']);

          return { description, requirements, department, location };
        });

        job.description = detail.description;
        job.requirements = detail.requirements;
        // 詳細ページの情報で上書き（一覧に無かった場合のみ）
        if (!job.department && detail.department) job.department = detail.department;
        if (!job.location && detail.location) job.location = detail.location;
      } catch {
        // 詳細ページの取得に失敗しても一覧データで続行
        logger.warn(`${this.companyId}: 詳細ページ取得失敗 - ${link.url}`);
      }

      // 自動分類
      const textForCategory = `${job.title} ${job.description ?? ''}`;
      job.jobCategory = classifyJobCategory(textForCategory);
      job.therapeuticArea = classifyTherapeuticArea(textForCategory);

      jobs.push(job);
    }

    return jobs;
  }
}

// ── 中外製薬インスタンス ──────────────────────────

export const chugaiScraper = new JpostingScraper(
  'chugai',
  'https://jsd.jposting.net/chugaicareer/',
);
