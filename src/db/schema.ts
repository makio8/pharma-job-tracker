/**
 * データベーススキーマ定義 & 初期化
 *
 * 実行方法: npm run setup  (= tsx src/db/schema.ts)
 * - data/pharma-jobs.db を作成/オープン
 * - 4テーブル + インデックスを作成
 * - 製薬企業20社のマスタデータを投入
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// プロジェクトルートを特定（このファイルは src/db/schema.ts にある）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, "..", "..");
const DATA_DIR = join(PROJECT_ROOT, "data");
const DB_PATH = join(DATA_DIR, "pharma-jobs.db");

// data/ ディレクトリがなければ作成
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

// データベースを作成/オープン
const db = new Database(DB_PATH);

// WALモード（書き込み性能向上）を有効化
db.pragma("journal_mode = WAL");
// 外部キー制約を有効化
db.pragma("foreign_keys = ON");

// ---------- テーブル作成 ----------

db.exec(`
  -- 企業マスタ
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name_ja TEXT NOT NULL,
    name_en TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('foreign', 'domestic')),
    careers_url TEXT NOT NULL,
    scraper TEXT NOT NULL,
    active INTEGER DEFAULT 1
  );

  -- 求人データ
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id TEXT NOT NULL REFERENCES companies(id),
    external_id TEXT,
    title TEXT NOT NULL,
    department TEXT,
    location TEXT,
    job_category TEXT,
    url TEXT,
    description TEXT,
    requirements TEXT,
    therapeutic_area TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 日次スナップショット
  CREATE TABLE IF NOT EXISTS daily_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_date TEXT NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    total_jobs INTEGER NOT NULL,
    new_jobs INTEGER DEFAULT 0,
    closed_jobs INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- X投稿ログ
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_type TEXT NOT NULL CHECK(post_type IN ('daily_summary', 'new_job', 'trend')),
    content TEXT NOT NULL,
    tweet_id TEXT,
    posted_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'success' CHECK(status IN ('success', 'failed'))
  );
`);

// ---------- インデックス作成 ----------

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen);
  CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(scan_date);
`);

// ---------- 企業マスタデータ投入 ----------

interface CompanySeed {
  id: string;
  name_ja: string;
  name_en: string;
  category: "foreign" | "domestic";
  careers_url: string;
  scraper: string;
}

const companies: CompanySeed[] = [
  // 外資系 (Foreign)
  { id: "pfizer",      name_ja: "ファイザー",                   name_en: "Pfizer",                 category: "foreign",  careers_url: "job.axol.jp/bx/s/pfizer_27/",                       scraper: "workday" },
  { id: "jnj",         name_ja: "ヤンセンファーマ",             name_en: "Johnson & Johnson",      category: "foreign",  careers_url: "careers.jnj.com",                                   scraper: "custom" },
  { id: "msd",         name_ja: "MSD",                          name_en: "MSD (Merck)",            category: "foreign",  careers_url: "jobs.msd.com/jpn-careers-ja",                       scraper: "custom" },
  { id: "novartis",    name_ja: "ノバルティス",                 name_en: "Novartis",               category: "foreign",  careers_url: "novartis.com/jp-ja/careers",                        scraper: "custom" },
  { id: "bms",         name_ja: "ブリストル・マイヤーズ スクイブ", name_en: "Bristol-Myers Squibb", category: "foreign",  careers_url: "bristolmyerssquibb.wd5.myworkdayjobs.com",          scraper: "workday" },
  { id: "lilly",       name_ja: "日本イーライリリー",           name_en: "Eli Lilly",              category: "foreign",  careers_url: "careers.lilly.com/jp/ja/japan",                     scraper: "custom" },
  { id: "astrazeneca", name_ja: "アストラゼネカ",               name_en: "AstraZeneca",            category: "foreign",  careers_url: "careers.astrazeneca.com/japan-jp",                  scraper: "workday" },
  { id: "sanofi",      name_ja: "サノフィ",                     name_en: "Sanofi",                 category: "foreign",  careers_url: "jobs.sanofi.com/en/location/japan-jobs",            scraper: "radancy" },
  { id: "abbvie",      name_ja: "アッヴィ",                     name_en: "AbbVie",                 category: "foreign",  careers_url: "careers.abbvie.com",                                scraper: "custom" },
  { id: "roche",       name_ja: "ロシュ",                       name_en: "Roche",                  category: "foreign",  careers_url: "roche.com/careers",                                 scraper: "custom" },

  // 内資系 (Domestic)
  { id: "takeda",        name_ja: "武田薬品工業",       name_en: "Takeda",            category: "domestic", careers_url: "takeda.wd3.myworkdayjobs.com",              scraper: "workday" },
  { id: "astellas",      name_ja: "アステラス製薬",     name_en: "Astellas",          category: "domestic", careers_url: "astellasjapan.avature.net",                 scraper: "avature" },
  { id: "daiichi-sankyo", name_ja: "第一三共",          name_en: "Daiichi Sankyo",    category: "domestic", careers_url: "daiichisankyo-recruiting.com",               scraper: "custom" },
  { id: "otsuka",        name_ja: "大塚ホールディングス", name_en: "Otsuka",          category: "domestic", careers_url: "otsuka.co.jp/recruit/",                     scraper: "custom" },
  { id: "eisai",         name_ja: "エーザイ",           name_en: "Eisai",             category: "domestic", careers_url: "hrmos.co/pages/eisai",                      scraper: "hrmos" },
  { id: "chugai",        name_ja: "中外製薬",           name_en: "Chugai",           category: "domestic", careers_url: "jsd.jposting.net/chugaicareer/",            scraper: "jposting" },
  { id: "ono",           name_ja: "小野薬品工業",       name_en: "Ono Pharmaceutical", category: "domestic", careers_url: "recruit.ono-pharma.com",                   scraper: "custom" },
  { id: "sumitomo",      name_ja: "住友ファーマ",       name_en: "Sumitomo Pharma",   category: "domestic", careers_url: "recruit.sumitomo-pharma.co.jp",              scraper: "custom" },
  { id: "tanabe",        name_ja: "田辺ファーマ",       name_en: "Tanabe Pharma",     category: "domestic", careers_url: "job.axol.jp/bx/c/mtpc/public/top",          scraper: "jposting" },
  { id: "kyowakirin",    name_ja: "協和キリン",         name_en: "Kyowa Kirin",       category: "domestic", careers_url: "hrmos.co/pages/kyowakirin",                  scraper: "hrmos" },
];

// INSERT OR IGNORE = 既に存在する行はスキップ
const insertCompany = db.prepare(`
  INSERT OR IGNORE INTO companies (id, name_ja, name_en, category, careers_url, scraper)
  VALUES (@id, @name_ja, @name_en, @category, @careers_url, @scraper)
`);

const seedCompanies = db.transaction((rows: CompanySeed[]) => {
  let inserted = 0;
  for (const row of rows) {
    const result = insertCompany.run(row);
    if (result.changes > 0) inserted++;
  }
  return inserted;
});

const insertedCount = seedCompanies(companies);

// ---------- 完了メッセージ ----------

const tableCount = db
  .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .get() as { cnt: number };

const companyCount = db
  .prepare("SELECT count(*) as cnt FROM companies")
  .get() as { cnt: number };

console.log("=== pharma-job-tracker DB 初期化完了 ===");
console.log(`  データベース: ${DB_PATH}`);
console.log(`  テーブル数:   ${tableCount.cnt}`);
console.log(`  企業マスタ:   ${companyCount.cnt} 社 (今回追加: ${insertedCount} 社)`);
console.log("========================================");

db.close();
