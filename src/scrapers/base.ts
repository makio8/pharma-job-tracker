/**
 * スクレイパーの共通インターフェースとベースクラス
 * 各企業用スクレイパーはこの BaseScraper を継承して実装する
 */

import { Page } from 'playwright';
import { SCRAPE_CONFIG } from '../config.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

// ── 型定義 ─────────────────────────────────────

/** 求人1件分のデータ */
export interface JobListing {
  /** サイト側の求人ID（あれば） */
  externalId?: string;
  /** 求人タイトル */
  title: string;
  /** 部門・部署 */
  department?: string;
  /** 勤務地 */
  location?: string;
  /** 求人カテゴリ（config の JOB_CATEGORIES キー） */
  jobCategory?: string;
  /** 求人詳細ページの URL */
  url?: string;
  /** 募集要項の全文（職務内容・仕事内容） */
  description?: string;
  /** 応募要件・必須スキル */
  requirements?: string;
  /** 疾患領域（オンコロジー、免疫等 → config の classifyTherapeuticArea で自動分類） */
  therapeuticArea?: string;
}

/** スクレイピング結果 */
export interface ScraperResult {
  /** 企業ID（例: 'pfizer', 'takeda'） */
  companyId: string;
  /** 取得した求人リスト */
  jobs: JobListing[];
  /** スクレイピング実行日時 */
  scrapedAt: Date;
  /** 成功したかどうか */
  success: boolean;
  /** エラー時のメッセージ */
  error?: string;
}

/** 全スクレイパーが実装すべきインターフェース */
export interface IScraper {
  companyId: string;
  scrape(page: Page): Promise<ScraperResult>;
}

// ── ベースクラス ───────────────────────────────

/**
 * 共通のスクレイパー基底クラス
 *
 * サブクラスは `companyId`, `url`, `extractJobs()` を実装するだけで
 * リトライ・エラーハンドリング・ログ出力が自動で付く
 */
export abstract class BaseScraper implements IScraper {
  /** 企業を一意に識別する ID */
  abstract companyId: string;

  /** スクレイピング対象の URL */
  abstract readonly url: string;

  /**
   * ページから求人情報を抽出するロジック（サブクラスで実装）
   * @param page - Playwright の Page オブジェクト（ナビゲーション済み）
   */
  abstract extractJobs(page: Page): Promise<JobListing[]>;

  /**
   * スクレイピングを実行する
   * ページ遷移 → 求人抽出 をリトライ付きで行い、ScraperResult を返す
   */
  async scrape(page: Page): Promise<ScraperResult> {
    logger.scrapeStart(this.companyId);

    try {
      const jobs = await withRetry(
        () => this.navigateAndExtract(page),
        {
          retries: SCRAPE_CONFIG.retryCount,
          delay: SCRAPE_CONFIG.retryDelay,
          label: this.companyId,
        },
      );

      logger.scrapeEnd(this.companyId, jobs.length);

      return {
        companyId: this.companyId,
        jobs,
        scrapedAt: new Date(),
        success: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.scrapeFail(this.companyId, message);

      return {
        companyId: this.companyId,
        jobs: [],
        scrapedAt: new Date(),
        success: false,
        error: message,
      };
    }
  }

  // ── private ───────────────────────────────

  /**
   * ページ遷移してから extractJobs を呼ぶ内部メソッド
   */
  private async navigateAndExtract(page: Page): Promise<JobListing[]> {
    await page.goto(this.url, {
      timeout: SCRAPE_CONFIG.timeout,
      waitUntil: 'networkidle',
    });
    return this.extractJobs(page);
  }
}
