/**
 * データベースクライアント
 *
 * SQLite への CRUD 操作をまとめたクラス。
 * シングルトンインスタンスを export する。
 */

import Database, { type Database as DatabaseType } from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- パス解決 ----------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const DB_PATH = join(DATA_DIR, "pharma-jobs.db");

// ---------- 型定義 ----------

/** companies テーブルの行 */
export interface Company {
  id: string;
  name_ja: string;
  name_en: string;
  category: "foreign" | "domestic";
  careers_url: string;
  scraper: string;
  active: number; // SQLite は boolean を 0/1 で保持
}

/** upsertJob に渡す求人データ */
export interface JobInput {
  external_id?: string;
  title: string;
  department?: string;
  location?: string;
  job_category?: string;
  url?: string;
  /** 募集要項の全文（職務内容・仕事内容） */
  description?: string;
  /** 応募要件・必須スキル */
  requirements?: string;
  /** 疾患領域（オンコロジー、免疫等） */
  therapeutic_area?: string;
}

/** jobs テーブルの行 */
export interface Job {
  id: number;
  company_id: string;
  external_id: string | null;
  title: string;
  department: string | null;
  location: string | null;
  job_category: string | null;
  url: string | null;
  description: string | null;
  requirements: string | null;
  therapeutic_area: string | null;
  first_seen: string;
  last_seen: string;
  status: "active" | "closed";
  created_at: string;
  updated_at: string;
}

/** daily_snapshots テーブルの行 */
export interface DailySnapshot {
  id: number;
  scan_date: string;
  company_id: string;
  total_jobs: number;
  new_jobs: number;
  closed_jobs: number;
  created_at: string;
}

/** posts テーブルの行 */
export interface Post {
  id: number;
  post_type: "daily_summary" | "new_job" | "trend";
  content: string;
  tweet_id: string | null;
  posted_at: string;
  status: "success" | "failed";
}

/** getCompanies のフィルタオプション */
export interface CompanyFilterOptions {
  active?: boolean;
  category?: string;
  scraper?: string;
}

// ---------- ヘルパー ----------

/** 今日の日付を YYYY-MM-DD 形式で返す */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 昨日の日付を YYYY-MM-DD 形式で返す */
function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------- DatabaseClient ----------

export class DatabaseClient {
  private db: DatabaseType;

  constructor(dbPath: string = DB_PATH) {
    // data/ ディレクトリがなければ作成
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** 生の Database インスタンスを返す（高度な操作用） */
  getDb(): DatabaseType {
    return this.db;
  }

  // ========== Companies ==========

  /**
   * 企業一覧を取得する
   * @param options - active / category / scraper でフィルタ可能
   */
  getCompanies(options: CompanyFilterOptions = {}): Company[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.active !== undefined) {
      conditions.push("active = @active");
      params.active = options.active ? 1 : 0;
    }
    if (options.category) {
      conditions.push("category = @category");
      params.category = options.category;
    }
    if (options.scraper) {
      conditions.push("scraper = @scraper");
      params.scraper = options.scraper;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM companies ${where} ORDER BY category, id`;

    return this.db.prepare(sql).all(params) as Company[];
  }

  // ========== Jobs ==========

  /**
   * 求人を挿入または更新する（upsert）
   *
   * マッチ条件:
   *   1. company_id + external_id（external_id がある場合）
   *   2. company_id + title + url（external_id がない場合のフォールバック）
   *
   * マッチした場合: last_seen と status を更新
   * マッチしない場合: 新規挿入
   *
   * @returns "inserted" | "updated"
   */
  upsertJob(companyId: string, job: JobInput): "inserted" | "updated" {
    const todayStr = today();

    // 既存レコードを検索
    let existing: Job | undefined;

    if (job.external_id) {
      existing = this.db
        .prepare("SELECT * FROM jobs WHERE company_id = ? AND external_id = ?")
        .get(companyId, job.external_id) as Job | undefined;
    }

    if (!existing && job.title && job.url) {
      existing = this.db
        .prepare("SELECT * FROM jobs WHERE company_id = ? AND title = ? AND url = ?")
        .get(companyId, job.title, job.url) as Job | undefined;
    }

    if (existing) {
      // 更新: last_seen を今日に、status を active に戻す
      this.db
        .prepare(
          `UPDATE jobs
           SET last_seen = ?, status = 'active', updated_at = datetime('now'),
               department = COALESCE(?, department),
               location = COALESCE(?, location),
               job_category = COALESCE(?, job_category),
               description = COALESCE(?, description),
               requirements = COALESCE(?, requirements),
               therapeutic_area = COALESCE(?, therapeutic_area)
           WHERE id = ?`
        )
        .run(
          todayStr,
          job.department ?? null,
          job.location ?? null,
          job.job_category ?? null,
          job.description ?? null,
          job.requirements ?? null,
          job.therapeutic_area ?? null,
          existing.id
        );
      return "updated";
    }

    // 新規挿入
    this.db
      .prepare(
        `INSERT INTO jobs (company_id, external_id, title, department, location, job_category, url, description, requirements, therapeutic_area, first_seen, last_seen, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        companyId,
        job.external_id ?? null,
        job.title,
        job.department ?? null,
        job.location ?? null,
        job.job_category ?? null,
        job.url ?? null,
        job.description ?? null,
        job.requirements ?? null,
        job.therapeutic_area ?? null,
        todayStr,
        todayStr
      );
    return "inserted";
  }

  /**
   * 指定企業のアクティブな求人を全件取得する
   */
  getActiveJobs(companyId: string): Job[] {
    return this.db
      .prepare("SELECT * FROM jobs WHERE company_id = ? AND status = 'active' ORDER BY first_seen DESC")
      .all(companyId) as Job[];
  }

  /**
   * 指定された external_id リストに含まれない求人を closed にする
   *
   * スクレイピング結果と DB を突合し、サイトから消えた求人を検出する。
   *
   * @param companyId - 企業 ID
   * @param activeExternalIds - 現在サイトに掲載されている求人の external_id 一覧
   * @returns closed にした件数
   */
  closeJobs(companyId: string, activeExternalIds: string[]): number {
    if (activeExternalIds.length === 0) {
      // 空リストの場合、全アクティブ求人を close
      const result = this.db
        .prepare(
          `UPDATE jobs SET status = 'closed', updated_at = datetime('now')
           WHERE company_id = ? AND status = 'active'`
        )
        .run(companyId);
      return result.changes;
    }

    // プレースホルダーを動的に生成
    const placeholders = activeExternalIds.map(() => "?").join(", ");
    const result = this.db
      .prepare(
        `UPDATE jobs SET status = 'closed', updated_at = datetime('now')
         WHERE company_id = ? AND status = 'active'
         AND external_id IS NOT NULL
         AND external_id NOT IN (${placeholders})`
      )
      .run(companyId, ...activeExternalIds);

    return result.changes;
  }

  // ========== Daily Snapshots ==========

  /**
   * 日次スナップショットを保存する
   */
  saveDailySnapshot(
    companyId: string,
    scanDate: string,
    totalJobs: number,
    newJobs: number,
    closedJobs: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO daily_snapshots (scan_date, company_id, total_jobs, new_jobs, closed_jobs)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(scanDate, companyId, totalJobs, newJobs, closedJobs);
  }

  /**
   * 昨日のスナップショットを取得する（前日比較用）
   */
  getYesterdaySnapshot(companyId: string): DailySnapshot | undefined {
    const yesterdayStr = yesterday();
    return this.db
      .prepare("SELECT * FROM daily_snapshots WHERE company_id = ? AND scan_date = ?")
      .get(companyId, yesterdayStr) as DailySnapshot | undefined;
  }

  // ========== Posts ==========

  /**
   * X 投稿ログを保存する
   */
  savePost(
    postType: "daily_summary" | "new_job" | "trend",
    content: string,
    tweetId?: string,
    status: "success" | "failed" = "success"
  ): void {
    this.db
      .prepare(
        `INSERT INTO posts (post_type, content, tweet_id, status)
         VALUES (?, ?, ?, ?)`
      )
      .run(postType, content, tweetId ?? null, status);
  }

  /** データベース接続を閉じる */
  close(): void {
    this.db.close();
  }
}

// ---------- シングルトンインスタンス ----------

export const dbClient = new DatabaseClient();
export default dbClient;
