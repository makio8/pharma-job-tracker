/**
 * JPOSTING スクレイパー
 *
 * JPOSTING は日本の採用管理システム（ATS）。
 * 一覧ページは SPA（JavaScript で動的にロード）。
 * 詳細ページはサブドメインが異なる（例: js03.jposting.net）ため、
 * 新しいタブで開いて取得する。
 *
 * 詳細ページには JSON-LD (Schema.org JobPosting) が埋め込まれており、
 * これを優先的に抽出する。
 *
 * 対応企業: 中外製薬（chugai）
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

// ── JSON-LD の JobPosting 型（必要なフィールドのみ） ──

interface JsonLdJobPosting {
  '@type'?: string;
  title?: string;
  description?: string;
  jobLocation?: {
    address?: {
      addressLocality?: string;
      addressRegion?: string;
    } | string;
  } | Array<{
    address?: {
      addressLocality?: string;
      addressRegion?: string;
    } | string;
  }>;
  qualifications?: string;
  skills?: string;
  experienceRequirements?: string;
  hiringOrganization?: {
    name?: string;
    department?: {
      name?: string;
    };
  };
  identifier?: {
    value?: string;
  };
}

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
    // JPOSTING は SPA なのでネットワーク安定を待つ
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
              url.searchParams.get('job_code') ||
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
              url.searchParams.get('job_code') ||
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
              url.searchParams.get('job_code') ||
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

    // ── 詳細ページを新しいタブで開いて description / requirements を取得 ──
    const jobs: JobListing[] = [];
    const targetLinks = jobLinks.slice(0, this.detailLimit);

    for (const link of targetLinks) {
      // external_id を URL の job_code パラメータから抽出
      let externalId = link.externalId;
      try {
        const parsedUrl = new URL(link.url);
        const jobCode = parsedUrl.searchParams.get('job_code');
        if (jobCode) externalId = jobCode;
      } catch {
        // URL パース失敗時は既存値を維持
      }

      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId,
        department: link.department,
        location: link.location,
      };

      // 詳細ページを新しいタブで開いてテキストを取得
      let detailPage: Page | null = null;
      try {
        // 新しいタブ（ページ）を開く — サブドメインが異なるため同一ページ遷移を避ける
        detailPage = await page.context().newPage();
        await detailPage.goto(link.url, { timeout: 20_000, waitUntil: 'networkidle' });

        // 1) JSON-LD (Schema.org JobPosting) を優先的に抽出
        const jsonLdData = await detailPage.evaluate(() => {
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (const script of scripts) {
            try {
              const data = JSON.parse(script.textContent || '');
              // 配列の場合も対応
              const items = Array.isArray(data) ? data : [data];
              for (const item of items) {
                if (item['@type'] === 'JobPosting') {
                  return item;
                }
                // @graph 内を探索
                if (item['@graph'] && Array.isArray(item['@graph'])) {
                  for (const graphItem of item['@graph']) {
                    if (graphItem['@type'] === 'JobPosting') {
                      return graphItem;
                    }
                  }
                }
              }
            } catch {
              // JSON パース失敗は無視して次のスクリプトタグへ
            }
          }
          return null;
        }) as JsonLdJobPosting | null;

        if (jsonLdData) {
          // JSON-LD から各フィールドを取得
          if (jsonLdData.title) {
            job.title = jsonLdData.title;
          }
          if (jsonLdData.description) {
            // HTML タグが含まれる場合があるのでテキスト化
            job.description = this.stripHtml(jsonLdData.description);
          }

          // 応募要件: qualifications / skills / experienceRequirements から取得
          const reqParts: string[] = [];
          if (jsonLdData.qualifications) reqParts.push(jsonLdData.qualifications);
          if (jsonLdData.skills) reqParts.push(jsonLdData.skills);
          if (jsonLdData.experienceRequirements) reqParts.push(jsonLdData.experienceRequirements);
          if (reqParts.length > 0) {
            job.requirements = this.stripHtml(reqParts.join('\n'));
          }

          // 勤務地
          if (!job.location && jsonLdData.jobLocation) {
            const locations = Array.isArray(jsonLdData.jobLocation)
              ? jsonLdData.jobLocation
              : [jsonLdData.jobLocation];
            const locTexts: string[] = [];
            for (const loc of locations) {
              if (loc.address) {
                if (typeof loc.address === 'string') {
                  locTexts.push(loc.address);
                } else {
                  const parts = [loc.address.addressRegion, loc.address.addressLocality].filter(Boolean);
                  if (parts.length > 0) locTexts.push(parts.join(' '));
                }
              }
            }
            if (locTexts.length > 0) job.location = locTexts.join(', ');
          }

          // 部門
          if (!job.department && jsonLdData.hiringOrganization?.department?.name) {
            job.department = jsonLdData.hiringOrganization.department.name;
          }

          // 外部ID（JSON-LD の identifier）
          if (!job.externalId && jsonLdData.identifier?.value) {
            job.externalId = jsonLdData.identifier.value;
          }

          logger.info(`${this.companyId}: JSON-LD から詳細取得成功 - ${link.url}`);
        } else {
          // 2) JSON-LD が無い場合は DOM フォールバック
          const detail = await detailPage.evaluate(() => {
            const getText = (selectors: string[]): string | undefined => {
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el?.textContent?.trim()) return el.textContent.trim();
              }
              return undefined;
            };

            const findTableValue = (labels: string[]): string | undefined => {
              const rows = document.querySelectorAll('tr, dt, th');
              for (const row of rows) {
                const text = row.textContent?.trim() || '';
                for (const label of labels) {
                  if (text.includes(label)) {
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
          if (!job.department && detail.department) job.department = detail.department;
          if (!job.location && detail.location) job.location = detail.location;

          logger.info(`${this.companyId}: DOM フォールバックで詳細取得 - ${link.url}`);
        }
      } catch (err) {
        // 詳細ページの取得に失敗しても一覧データで続行
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`${this.companyId}: 詳細ページ取得失敗 - ${link.url} | エラー: ${message}`);
      } finally {
        // 新しいタブは必ず閉じる
        if (detailPage) {
          try {
            await detailPage.close();
          } catch {
            // タブのクローズ失敗は無視
          }
        }
      }

      // 自動分類
      const textForCategory = `${job.title} ${job.description ?? ''}`;
      job.jobCategory = classifyJobCategory(textForCategory);
      job.therapeuticArea = classifyTherapeuticArea(textForCategory);

      jobs.push(job);
    }

    return jobs;
  }

  /** HTML タグとエンティティを除去してプレーンテキストにする */
  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}

// ── 中外製薬インスタンス ──────────────────────────

export const chugaiScraper = new JpostingScraper(
  'chugai',
  'https://jsd.jposting.net/chugaicareer/',
);
