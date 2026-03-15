/**
 * Workday キャリアページ用スクレイパー
 *
 * 対象企業:
 *   - 武田薬品: https://takeda.wd3.myworkdayjobs.com/TakedaCareers
 *   - ファイザー: https://pfizer.wd1.myworkdayjobs.com/PfizerCareers
 *
 * Workday は共通の JSON API を提供しており、
 * POST /wday/cxs/{company}/{sitePath}/jobs で求人一覧を取得できる。
 * API が使えない場合は DOM スクレイピングにフォールバックする。
 */

import { Page } from 'playwright';
import { BaseScraper, JobListing } from './base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

// ── 定数 ────────────────────────────────────────
/** 1回の API リクエストで取得する件数 */
const PAGE_SIZE = 20;
/** API ページネーションの最大取得件数（安全弁） */
const MAX_JOBS = 500;
/** 詳細を API から取る最大件数 */
const DETAIL_LIMIT = 50;
/** 詳細取得の待機時間（ミリ秒） */
const DETAIL_DELAY = 500;
/** API リクエストのタイムアウト（ミリ秒） */
const API_TIMEOUT = 15_000;

/** 日本拠点を判定するキーワード */
const JAPAN_LOCATION_KEYWORDS = [
  'japan', 'tokyo', 'osaka', 'nagoya', 'kyoto', 'yokohama', 'kobe',
  'fukuoka', 'sapporo', 'sendai', 'hiroshima', 'chiba', 'saitama',
  'kanagawa', 'ibaraki', 'shizuoka', 'hyogo', 'aichi', 'hokkaido',
  '日本', '東京', '大阪', '名古屋', '横浜', '神戸', '福岡', '札幌',
  '仙台', '広島', '千葉', '埼玉', '神奈川', '茨城', '静岡', '兵庫',
  '愛知', '北海道', '光', 'hikari',  // 武田の光工場
];

// ── Workday API レスポンス型 ─────────────────────

interface WorkdayJobPosting {
  title: string;
  externalPath: string;       // "/job/Tokyo/Job-Title/JR12345" 形式
  locationsText?: string;
  bulletFields?: string[];
  postedOn?: string;
}

interface WorkdayJobsResponse {
  total: number;
  jobPostings: WorkdayJobPosting[];
}

interface WorkdayJobDetail {
  jobPostingInfo?: {
    title?: string;
    externalUrl?: string;
    location?: string;
    timeType?: string;
    jobDescription?: string;  // HTML 形式の募集要項
    additionalLocations?: string[];
    jobReqId?: string;
  };
}

// ── クラス定義 ──────────────────────────────────

export class WorkdayScraper extends BaseScraper {
  companyId: string;
  readonly url: string;

  private company: string;     // URL パス用の企業名（例: 'takeda'）
  private wdInstance: string;   // Workday インスタンス番号（例: 'wd3'）
  private sitePath: string;     // サイトパス（例: 'TakedaCareers'）
  private baseApiUrl: string;

  private searchText: string;

  /**
   * @param companyId  - 内部ID
   * @param company    - Workday URL の企業スラッグ
   * @param wdInstance - Workday インスタンス（'wd1', 'wd3' 等）
   * @param sitePath   - キャリアサイトのパス名
   * @param searchText - API 検索テキスト（例: 'Japan' で日本求人に絞り込み）
   */
  constructor(
    companyId: string,
    company: string,
    wdInstance: string,
    sitePath: string,
    searchText: string = '',
  ) {
    super();
    this.companyId = companyId;
    this.company = company;
    this.wdInstance = wdInstance;
    this.sitePath = sitePath;
    this.searchText = searchText;
    this.url = `https://${company}.${wdInstance}.myworkdayjobs.com/${sitePath}`;
    this.baseApiUrl = `https://${company}.${wdInstance}.myworkdayjobs.com`;
  }

  // ── メイン抽出ロジック ─────────────────────────

  async extractJobs(page: Page): Promise<JobListing[]> {
    // Strategy A: JSON API を試す
    let jobs = await this.tryApiStrategy(page);

    // Strategy B: API 失敗時は DOM フォールバック
    if (jobs === null) {
      logger.warn(`[${this.companyId}] API 取得失敗 — DOM スクレイピングにフォールバック`);
      jobs = await this.domFallbackStrategy(page);
    }

    // 日本拠点の求人のみにフィルタ（グローバルサイトから取得するため）
    const beforeFilter = jobs.length;
    jobs = jobs.filter((job) => this.isJapanJob(job));
    if (beforeFilter !== jobs.length) {
      logger.info(`[${this.companyId}] 日本フィルタ: ${beforeFilter}件 → ${jobs.length}件`);
    }

    logger.info(`[${this.companyId}] 合計 ${jobs.length} 件の求人を取得`);

    // 自動分類
    return jobs.map((job) => this.classify(job));
  }

  // ── Strategy A: Workday JSON API ───────────────

  private async tryApiStrategy(page: Page): Promise<JobListing[] | null> {
    try {
      const allJobs: JobListing[] = [];
      let offset = 0;
      let total = Infinity;

      // ページネーションループ
      while (offset < total && offset < MAX_JOBS) {
        const response = await this.fetchJobsApi(page, offset);
        if (!response) return null;

        total = response.total;

        for (const posting of response.jobPostings) {
          const job = this.parseApiPosting(posting);
          if (job) allJobs.push(job);
        }

        offset += PAGE_SIZE;

        // レート制限対策
        if (offset < total) {
          await page.waitForTimeout(DETAIL_DELAY);
        }
      }

      // 詳細情報を API から取得（上限あり）
      await this.enrichWithApiDetails(page, allJobs);

      return allJobs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[${this.companyId}] API Strategy 失敗: ${msg}`);
      return null;
    }
  }

  /**
   * Workday の求人一覧 API を呼び出す
   * page.evaluate 内で fetch() を実行し、同一オリジンの CORS 制約を回避
   */
  private async fetchJobsApi(
    page: Page,
    offset: number,
  ): Promise<WorkdayJobsResponse | null> {
    const apiUrl = `${this.baseApiUrl}/wday/cxs/${this.company}/${this.sitePath}/jobs`;

    const result = await page.evaluate(
      async ({ url, body }: { url: string; body: object }) => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      },
      {
        url: apiUrl,
        body: {
          appliedFacets: {},
          limit: PAGE_SIZE,
          offset,
          searchText: this.searchText,
        },
      },
    );

    if (!result || !result.jobPostings) return null;
    return result as WorkdayJobsResponse;
  }

  /**
   * API の一覧レスポンスから JobListing を組み立てる
   */
  private parseApiPosting(posting: WorkdayJobPosting): JobListing | null {
    if (!posting.title) return null;

    // externalPath: "/job/Tokyo/Job-Title/JR12345"
    const pathParts = posting.externalPath?.split('/').filter(Boolean) ?? [];
    // 最後のセグメントを externalId として使う（求人番号であることが多い）
    const externalId = pathParts.length > 0
      ? pathParts[pathParts.length - 1]
      : undefined;

    return {
      title: posting.title,
      externalId,
      location: posting.locationsText,
      url: `${this.url}${posting.externalPath ?? ''}`,
      department: posting.bulletFields?.[0], // 最初の bulletField が部門のことが多い
    };
  }

  /**
   * 個別求人の詳細 API を呼んで description を取得
   * API: GET /wday/cxs/{company}/{sitePath}{externalPath}
   */
  private async enrichWithApiDetails(
    page: Page,
    jobs: JobListing[],
  ): Promise<void> {
    const toEnrich = jobs.slice(0, DETAIL_LIMIT);

    for (const job of toEnrich) {
      if (!job.url) continue;

      try {
        // externalPath を URL から再構成
        const urlObj = new URL(job.url);
        const externalPath = urlObj.pathname.replace(`/${this.sitePath}`, '');
        const detailApiUrl = `${this.baseApiUrl}/wday/cxs/${this.company}/${this.sitePath}${externalPath}`;

        const detail: WorkdayJobDetail | null = await page.evaluate(
          async (url: string) => {
            try {
              const res = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
              });
              if (!res.ok) return null;
              return await res.json();
            } catch {
              return null;
            }
          },
          detailApiUrl,
        );

        if (detail?.jobPostingInfo) {
          const info = detail.jobPostingInfo;

          // HTML タグを除去してプレーンテキスト化
          if (info.jobDescription) {
            job.description = this.stripHtml(info.jobDescription);
          }

          // 応募要件は description 内に含まれることが多いため、
          // キーワードで分割を試みる
          if (job.description) {
            job.requirements = this.extractRequirements(job.description);
          }

          // API から追加情報があれば補完
          if (!job.location && info.location) {
            job.location = info.location;
          }
          if (info.jobReqId) {
            job.externalId = info.jobReqId;
          }
        }

        await page.waitForTimeout(DETAIL_DELAY);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[${this.companyId}] 詳細API取得失敗 (${job.externalId}): ${msg}`);
      }
    }
  }

  // ── Strategy B: DOM スクレイピング ──────────────

  private async domFallbackStrategy(page: Page): Promise<JobListing[]> {
    try {
      // ページ遷移（すでに navigateAndExtract で遷移済みだが念のため）
      await page.goto(this.url, {
        timeout: API_TIMEOUT,
        waitUntil: 'networkidle',
      });

      // 求人リストの表示を待つ
      await page.waitForSelector(
        '[data-automation-id="jobTitle"], a[data-automation-id="jobTitle"], section[data-automation-id="jobResults"]',
        { timeout: 10_000 },
      ).catch(() => {
        // Workday の DOM 構造が変わっている可能性 — 続行
      });

      // DOM から求人情報を取得
      const jobs = await page.evaluate((baseUrl: string) => {
        const results: JobListing[] = [];

        // Workday 共通のセレクタパターン
        const jobCards = document.querySelectorAll(
          '[data-automation-id="jobResults"] li, ' +
          'section[data-automation-id="jobResults"] > ul > li, ' +
          '[class*="job"] li, ' +
          'a[data-automation-id="jobTitle"]',
        );

        if (jobCards.length === 0) {
          // フォールバック: すべてのリンクから求人っぽいものを探す
          document.querySelectorAll<HTMLAnchorElement>('a[href*="/job/"]').forEach((link) => {
            const title = link.textContent?.trim() ?? '';
            if (!title) return;

            const href = link.getAttribute('href') ?? '';
            const pathParts = href.split('/').filter(Boolean);
            const externalId = pathParts[pathParts.length - 1];

            results.push({
              title,
              externalId,
              url: href.startsWith('http') ? href : `${baseUrl}${href}`,
            });
          });
          return results;
        }

        jobCards.forEach((card) => {
          // タイトル取得
          const titleEl =
            card.querySelector('[data-automation-id="jobTitle"]') ??
            card.querySelector('a h3, a h4, a [class*="title"]');

          const title = titleEl?.textContent?.trim() ?? '';
          if (!title) return;

          // URL
          const linkEl =
            card.querySelector<HTMLAnchorElement>('a[data-automation-id="jobTitle"]') ??
            card.querySelector<HTMLAnchorElement>('a[href*="/job/"]') ??
            (card.tagName === 'A' ? card as HTMLAnchorElement : null);

          const href = linkEl?.getAttribute('href') ?? '';
          const url = href.startsWith('http') ? href : `${baseUrl}${href}`;

          // externalId
          const pathParts = href.split('/').filter(Boolean);
          const externalId = pathParts[pathParts.length - 1];

          // location
          const locationEl = card.querySelector(
            '[data-automation-id="locations"], [class*="location"], [class*="Location"]',
          );
          const location = locationEl?.textContent?.trim() ?? undefined;

          results.push({ title, externalId, url, location });
        });

        return results;
      }, this.url);

      return jobs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[${this.companyId}] DOM フォールバックも失敗: ${msg}`);
      return [];
    }
  }

  // ── ユーティリティ ────────────────────────────

  /** HTML タグを除去してプレーンテキストにする */
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
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * description テキストから応募要件セクションを抜き出す
   * 「応募要件」「Qualifications」「Requirements」等のキーワード以降を返す
   */
  private extractRequirements(description: string): string | undefined {
    const patterns = [
      /(?:応募要件|必須条件|必要な経験|資格・要件|Required|Qualifications|Requirements|What you need)[\s:：]*([\s\S]+)/i,
    ];

    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match?.[1]) {
        // 次のセクションヘッダで切る
        const section = match[1].split(
          /\n(?:歓迎条件|待遇|勤務地|選考|Preferred|Benefits|About|How to|What we offer)/i,
        )[0];
        return section?.trim() || undefined;
      }
    }

    return undefined;
  }

  /**
   * 日本拠点の求人かどうかを判定する
   * location テキストにキーワードが含まれていれば日本と判定
   * location が空の場合は保持する（後で詳細 API で補完される可能性あり）
   */
  private isJapanJob(job: JobListing): boolean {
    if (!job.location) return true; // location 不明は保持
    const loc = job.location.toLowerCase();
    return JAPAN_LOCATION_KEYWORDS.some((kw) => loc.includes(kw.toLowerCase()));
  }

  /** 求人カテゴリと疾患領域を自動分類 */
  private classify(job: JobListing): JobListing {
    const textForCategory = [job.title, job.department ?? ''].join(' ');
    const textForTA = [job.title, job.description ?? ''].join(' ');

    job.jobCategory = classifyJobCategory(textForCategory);
    job.therapeuticArea = classifyTherapeuticArea(textForTA);

    return job;
  }
}

// ── ファクトリ（企業ごとのインスタンス） ──────────

/** 武田薬品工業（グローバルサイトなので 'Japan' で絞り込み） */
export const takedaScraper = new WorkdayScraper('takeda', 'takeda', 'wd3', 'External', 'Japan');

/** ファイザー（グローバルサイトなので 'Japan' で絞り込み） */
export const pfizerScraper = new WorkdayScraper('pfizer', 'pfizer', 'wd1', 'PfizerCareers', 'Japan');

/** BMS（wd5 インスタンス） */
export const bmsScraper = new WorkdayScraper('bms', 'bristolmyerssquibb', 'wd5', 'BMS', 'Japan');

/** J&J / ヤンセンファーマ（wd5 インスタンス） */
export const jnjScraper = new WorkdayScraper('jnj', 'jj', 'wd5', 'JJ', 'Japan');

/** ノバルティス（wd3 インスタンス） */
export const novartisScraper = new WorkdayScraper('novartis', 'novartis', 'wd3', 'Novartis_Careers', 'Japan');

/** イーライリリー（wd5 インスタンス — Phenom フロントエンドだが Workday API も利用可能） */
export const lillyScraper = new WorkdayScraper('lilly', 'lilly', 'wd5', 'Lilly', 'Japan');

/** 大塚製薬（wd1 インスタンス、日本専用サイト） */
export const otsukaScraper = new WorkdayScraper('otsuka', 'vhr-otsuka', 'wd1', 'Japan_External_Career_Site_OPC');
