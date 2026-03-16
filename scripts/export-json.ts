/**
 * export-json.ts
 *
 * pharma-jobs.db から JSON ファイルを生成し web/public/data/ に書き出す。
 * 実行方法: npm run export  (= tsx scripts/export-json.ts)
 *
 * 出力ファイル:
 *   meta.json        - サマリー情報
 *   companies.json   - 企業一覧 + active_jobs 数
 *   jobs.json        - active な全求人（description/requirements 除外）
 *   snapshots.json   - 過去 90 日の daily_snapshots
 *   new-today.json   - 今日初掲載の求人
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- パス設定 ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, ".."); // pharma-job-tracker/
const DB_PATH = join(PROJECT_ROOT, "data", "pharma-jobs.db");
const OUTPUT_DIR = join(PROJECT_ROOT, "web", "public", "data");

// ---- 出力ディレクトリ確認・作成 ----
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`出力ディレクトリを作成しました: ${OUTPUT_DIR}`);
}

// ---- DB をリードオンリーで開く ----
let db: Database.Database;
try {
  db = new Database(DB_PATH, { readonly: true });
} catch (err) {
  console.error(`[ERROR] データベースを開けませんでした: ${DB_PATH}`);
  console.error((err as Error).message);
  process.exit(1);
}

// ---- ヘルパー: JSON ファイルを書き出す ----
function writeJson(filename: string, data: unknown): void {
  const path = join(OUTPUT_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  書き出し完了: ${filename}`);
}

try {
  // ========== meta.json ==========
  const totalActiveJobs = (
    db.prepare("SELECT COUNT(*) as cnt FROM jobs WHERE status = 'active'").get() as { cnt: number }
  ).cnt;

  const newToday = (
    db
      .prepare("SELECT COUNT(*) as cnt FROM jobs WHERE first_seen = date('now') AND status = 'active'")
      .get() as { cnt: number }
  ).cnt;

  const companiesCount = (
    db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE active = 1").get() as { cnt: number }
  ).cnt;

  const meta = {
    last_updated: new Date().toISOString(),
    total_active_jobs: totalActiveJobs,
    new_today: newToday,
    companies_count: companiesCount,
  };

  writeJson("meta.json", meta);

  // ========== companies.json ==========
  const companies = db
    .prepare(
      `
      SELECT
        c.id,
        c.name_ja,
        c.name_en,
        c.category,
        c.careers_url,
        c.scraper,
        c.active,
        COALESCE(j.active_jobs, 0) AS active_jobs
      FROM companies c
      LEFT JOIN (
        SELECT company_id, COUNT(*) AS active_jobs
        FROM jobs
        WHERE status = 'active'
        GROUP BY company_id
      ) j ON c.id = j.company_id
      ORDER BY active_jobs DESC, c.name_ja
      `
    )
    .all();

  writeJson("companies.json", companies);

  // ========== jobs.json ==========
  const jobs = db
    .prepare(
      `
      SELECT
        id,
        company_id,
        external_id,
        title,
        department,
        location,
        job_category,
        url,
        description,
        requirements,
        therapeutic_area,
        first_seen,
        last_seen,
        status
      FROM jobs
      WHERE status = 'active'
      ORDER BY first_seen DESC, id DESC
      `
    )
    .all();

  writeJson("jobs.json", jobs);

  // ========== snapshots.json ==========
  const snapshots = db
    .prepare(
      `
      SELECT id, scan_date, company_id, total_jobs, new_jobs, closed_jobs
      FROM daily_snapshots
      WHERE scan_date >= date('now', '-90 days')
      ORDER BY scan_date DESC, company_id
      `
    )
    .all();

  writeJson("snapshots.json", snapshots);

  // ========== new-today.json ==========
  const newTodayJobs = db
    .prepare(
      `
      SELECT
        id,
        company_id,
        external_id,
        title,
        department,
        location,
        job_category,
        url,
        description,
        requirements,
        therapeutic_area,
        first_seen,
        last_seen,
        status
      FROM jobs
      WHERE first_seen = date('now') AND status = 'active'
      ORDER BY id DESC
      `
    )
    .all();

  writeJson("new-today.json", newTodayJobs);

  console.log("\n========== JSON エクスポート完了 ==========");
  console.log(`  出力先: ${OUTPUT_DIR}`);
  console.log(`  総 active 求人数: ${totalActiveJobs}`);
  console.log(`  今日の新着: ${newToday}`);
  console.log(`  追跡企業数: ${companiesCount}`);
  console.log("============================================");
} catch (err) {
  console.error("[ERROR] エクスポート中にエラーが発生しました:");
  console.error((err as Error).message);
  db.close();
  process.exit(1);
} finally {
  db.close();
}
