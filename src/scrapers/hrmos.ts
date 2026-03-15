/**
 * HRMOS キャリアページ用スクレイパー
 *
 * 対象企業:
 *   - エーザイ:   https://hrmos.co/pages/eisai
 *   - 協和キリン: https://hrmos.co/pages/kyowakirin
 *
 * HRMOS の求人一覧ページには求人カード（リンク付き）が並んでおり、
 * 各カードから詳細ページ `/jobs/{jobId}` へ遷移できる。
 */

import { Page } from 'playwright';
import { BaseScraper, JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

// ── 定数 ────────────────────────────────────────
const HRMOS_BASE = 'https://hrmos.co/pages';
/** 詳細ページを取得する最大件数（速度とのバランス） */
const DETAIL_PAGE_LIMIT = 50;
/** 詳細ページ遷移時のタイムアウト（ミリ秒） */
const DETAIL_TIMEOUT = 15_000;
/** 詳細ページ間の待機時間（ミリ秒）— サーバー負荷軽減 */
const DETAIL_DELAY = 1_000;

// ── クラス定義 ──────────────────────────────────

export class HrmosScraper extends BaseScraper {
  companyId: string;
  readonly url: string;
  private hrmosSlug: string;

  /**
   * @param companyId  - 企業を識別する内部ID（例: 'eisai'）
   * @param hrmosSlug  - HRMOS の URL パスに使われるスラッグ（例: 'eisai'）
   */
  constructor(companyId: string, hrmosSlug: string) {
    super();
    this.companyId = companyId;
    this.hrmosSlug = hrmosSlug;
    // ランディングページではなく求人一覧ページを直接開く
    this.url = `${HRMOS_BASE}/${hrmosSlug}/jobs`;
  }

  // ── メイン抽出ロジック ─────────────────────────

  async extractJobs(page: Page): Promise<JobListing[]> {
    // 求人一覧が描画されるまで待つ
    await this.waitForJobList(page);

    // 一覧ページから基本情報を取得
    const summaries = await this.extractJobSummaries(page);
    logger.info(`[${this.companyId}] 一覧ページから ${summaries.length} 件の求人を検出`);

    if (summaries.length === 0) {
      return [];
    }

    // 詳細ページから description / requirements を取得（上限あり）
    const jobs = await this.enrichWithDetails(page, summaries);

    // 自動分類（カテゴリ・疾患領域）
    return jobs.map((job) => this.classify(job));
  }

  // ── 一覧ページの待機 ──────────────────────────

  private async waitForJobList(page: Page): Promise<void> {
    try {
      // HRMOS は SPA 風のレンダリングをするため、求人リンクが出るまで待つ
      // 典型的なセレクタ候補を順に試す
      await page.waitForSelector(
        'a[href*="/jobs/"]',
        { timeout: 10_000 },
      ).catch(() =>
        // フォールバック: ページ全体のロードを待つ
        page.waitForLoadState('networkidle', { timeout: 10_000 }),
      );
    } catch {
      logger.warn(`[${this.companyId}] 求人一覧の読み込みがタイムアウト — DOM がそのまま使える可能性あり`);
    }
  }

  // ── 一覧ページから求人サマリーを抽出 ────────────

  private async extractJobSummaries(page: Page): Promise<JobListing[]> {
    return page.evaluate((slug: string) => {
      const results: JobListing[] = [];
      const baseUrl = `https://hrmos.co/pages/${slug}`;

      // ── セレクタ戦略 1: /jobs/ を含むリンクを探す ──
      const jobLinks = document.querySelectorAll<HTMLAnchorElement>(
        `a[href*="/pages/${slug}/jobs/"]`,
      );

      if (jobLinks.length > 0) {
        jobLinks.forEach((link) => {
          const href = link.getAttribute('href') ?? '';
          // jobId を URL パスから取得  /pages/{slug}/jobs/{jobId}
          const match = href.match(/\/jobs\/([^/?#]+)/);
          const externalId = match ? match[1] : undefined;

          // タイトル: リンクテキスト or 子要素のテキスト
          const title =
            link.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]')
              ?.textContent?.trim() ??
            link.textContent?.trim() ??
            '';

          if (!title) return; // タイトルなしはスキップ

          // UI テキスト（ボタン・ラベル等）をフィルタ
          const uiPatterns = /^(雇用形態|この会社の求人|勤務地|給与|応募|検索|もっと見る|loading|読み込み)/i;
          if (uiPatterns.test(title) || title.length < 4) return;
          // 「○○株式会社 の求人を探す」パターンもフィルタ
          if (/の求人を探す|求人一覧|トップページ/i.test(title)) return;

          // 親要素からメタ情報を探す
          const card =
            link.closest('[class*="card"], [class*="Card"], [class*="item"], [class*="Item"], li, article') ??
            link.parentElement;

          const department =
            card?.querySelector('[class*="department"], [class*="Department"], [class*="team"], [class*="Team"]')
              ?.textContent?.trim() ?? undefined;

          const location =
            card?.querySelector('[class*="location"], [class*="Location"], [class*="area"], [class*="Area"]')
              ?.textContent?.trim() ?? undefined;

          const fullUrl = href.startsWith('http')
            ? href
            : `https://hrmos.co${href}`;

          results.push({
            externalId,
            title,
            department,
            location,
            url: fullUrl,
          });
        });

        return results;
      }

      // ── セレクタ戦略 2: カード系要素から探す ──
      const cards = document.querySelectorAll(
        '[class*="job"], [class*="Job"], [class*="card"], [class*="Card"], [class*="vacancy"], [class*="Vacancy"]',
      );

      cards.forEach((card) => {
        const link = card.querySelector<HTMLAnchorElement>('a[href]');
        const href = link?.getAttribute('href') ?? '';

        const title =
          card.querySelector('h2, h3, h4, [class*="title"], [class*="Title"]')
            ?.textContent?.trim() ?? '';

        if (!title) return;

        // UI テキスト（ボタン・ラベル等）をフィルタ
        const uiPatterns2 = /^(雇用形態|この会社の求人|勤務地|給与|応募|検索|もっと見る|loading|読み込み)/i;
        if (uiPatterns2.test(title) || title.length < 4) return;

        const match = href.match(/\/jobs\/([^/?#]+)/);
        const externalId = match ? match[1] : undefined;

        const department =
          card.querySelector('[class*="department"], [class*="Department"]')
            ?.textContent?.trim() ?? undefined;

        const location =
          card.querySelector('[class*="location"], [class*="Location"]')
            ?.textContent?.trim() ?? undefined;

        const fullUrl = href.startsWith('http')
          ? href
          : href
            ? `https://hrmos.co${href}`
            : `${baseUrl}`;

        results.push({
          externalId,
          title,
          department,
          location,
          url: fullUrl,
        });
      });

      return results;
    }, this.hrmosSlug);
  }

  // ── 詳細ページで description / requirements を取得 ─

  private async enrichWithDetails(
    page: Page,
    summaries: JobListing[],
  ): Promise<JobListing[]> {
    const toVisit = summaries.slice(0, DETAIL_PAGE_LIMIT);
    const remaining = summaries.slice(DETAIL_PAGE_LIMIT);

    for (const job of toVisit) {
      if (!job.url) continue;

      // 詳細ページは新しいタブで開く（一覧ページを維持するため）
      let detailPage: Page | null = null;
      try {
        detailPage = await page.context().newPage();
        await detailPage.goto(job.url, {
          timeout: DETAIL_TIMEOUT,
          waitUntil: 'domcontentloaded',
        });

        // 本文が表示されるまで少し待つ
        await detailPage.waitForSelector(
          '[class*="detail"], [class*="Detail"], [class*="description"], [class*="body"], main, article',
          { timeout: 5_000 },
        ).catch(() => {/* DOM がなくても続行 */});

        // NOTE: page.evaluate 内の const アロー関数は tsx (esbuild) が
        // __name ヘルパーを注入するためブラウザ内で ReferenceError になる。
        // Playwright Locator API を使って直接テキストを取得する。
        const detail = await this.extractDetailWithLocators(detailPage);

        // 詳細から取れた値で上書き（一覧で取れなかったフィールドのみ）
        job.description = detail.description;
        job.requirements = detail.requirements;
        if (!job.department && detail.department) job.department = detail.department;
        if (!job.location && detail.location) job.location = detail.location;

        logger.info(`[${this.companyId}] 詳細取得成功 - ${job.externalId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[${this.companyId}] 詳細ページ取得失敗 (${job.externalId}): ${msg}`);
        // 詳細取得に失敗しても一覧データは残す
      } finally {
        if (detailPage) {
          try { await detailPage.close(); } catch { /* タブクローズ失敗は無視 */ }
        }
      }

      // サーバーに優しく
      await page.waitForTimeout(DETAIL_DELAY);
    }

    // 詳細未取得の残りと結合して返す
    return [...toVisit, ...remaining];
  }

  // ── 詳細ページからテキスト抽出 ──────────────────

  /**
   * 詳細ページからフィールドを取得する。
   * page.evaluate 内では const アロー関数を使わない
   * （tsx/esbuild が __name ヘルパーを注入し、ブラウザ内で ReferenceError になるため）
   */
  private async extractDetailWithLocators(
    dp: Page,
  ): Promise<{ description?: string; requirements?: string; department?: string; location?: string }> {
    // evaluate に渡す関数はラベル配列を引数で受け取り、
    // ヘルパー関数は function 宣言ではなくインラインで処理する
    return dp.evaluate((labelSets: Record<string, string[]>) => {
      // ── インラインヘルパー: ラベルに一致する見出しの直後テキストを取得 ──
      // NOTE: 名前付き const を避けるため、結果オブジェクトを直接構築する
      const result: Record<string, string | undefined> = {};

      for (const [key, labels] of Object.entries(labelSets)) {
        let found: string | undefined;
        const headings = document.querySelectorAll('h1, h2, h3, h4, h5, dt, th, strong, b');
        for (let i = 0; i < headings.length && !found; i++) {
          const heading = headings[i];
          const text = heading.textContent?.trim() || '';
          for (const label of labels) {
            if (!text.includes(label)) continue;

            // dt → dd パターン
            if (heading.tagName === 'DT') {
              const dd = heading.nextElementSibling;
              if (dd?.tagName === 'DD' && dd.textContent?.trim()) {
                found = dd.textContent.trim();
                break;
              }
            }
            // th → td パターン
            if (heading.tagName === 'TH') {
              const tr = heading.closest('tr');
              const td = tr?.querySelector('td');
              if (td?.textContent?.trim()) {
                found = td.textContent.trim();
                break;
              }
            }
            // 見出し → 次の兄弟
            const sibling = heading.nextElementSibling;
            if (sibling?.textContent?.trim()) {
              found = sibling.textContent.trim();
              break;
            }
            // 見出しの親 → 次の兄弟
            const parentSibling = heading.parentElement?.nextElementSibling;
            if (parentSibling?.textContent?.trim()) {
              found = parentSibling.textContent.trim();
              break;
            }
          }
        }
        result[key] = found;
      }

      // フォールバック: description が取れなかった場合はクラス名ベース or 本文全体
      if (!result.description) {
        const descEl = document.querySelector(
          '[class*="description"], [class*="Description"], [class*="detail"], [class*="Detail"]',
        );
        if (descEl?.textContent?.trim()) {
          result.description = descEl.textContent.trim();
        } else {
          const main = document.querySelector('main, article, [role="main"]');
          if (main?.textContent?.trim()) {
            result.description = main.textContent.trim();
          }
        }
      }

      // フォールバック: location / department
      if (!result.department) {
        const el = document.querySelector('[class*="department"], [class*="Department"], [class*="team"], [class*="Team"]');
        if (el?.textContent?.trim()) result.department = el.textContent.trim();
      }
      if (!result.location) {
        const el = document.querySelector('[class*="location"], [class*="Location"]');
        if (el?.textContent?.trim()) result.location = el.textContent.trim();
      }

      return {
        description: result.description,
        requirements: result.requirements,
        department: result.department,
        location: result.location,
      };
    }, {
      description: ['仕事内容', '職務内容', '業務内容', '募集内容', 'Job Description', 'Responsibilities'],
      requirements: ['応募資格', '応募要件', '必須条件', '必須スキル', 'Requirements', 'Qualifications'],
      department: ['部門', '部署', '配属先', 'Department'],
      location: ['勤務地', '就業場所', 'Location'],
    });
  }

  // ── 自動分類 ──────────────────────────────────

  private classify(job: JobListing): JobListing {
    // タイトル + description を結合して分類精度を上げる
    const textForCategory = [job.title, job.department ?? ''].join(' ');
    const textForTA = [job.title, job.description ?? ''].join(' ');

    job.jobCategory = classifyJobCategory(textForCategory);
    job.therapeuticArea = classifyTherapeuticArea(textForTA);

    return job;
  }
}

// ── ファクトリ（企業ごとのインスタンス） ──────────

/** エーザイ */
export const eisaiScraper = new HrmosScraper('eisai', 'eisai');

/** 協和キリン */
export const kyowakirinScraper = new HrmosScraper('kyowakirin', 'kyowakirin');
