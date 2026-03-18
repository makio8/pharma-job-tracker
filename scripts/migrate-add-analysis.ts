/**
 * マイグレーション: jobs テーブルに analysis_data カラムを追加
 *
 * 実行: npx tsx scripts/migrate-add-analysis.ts
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'pharma-jobs.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// カラムが存在するか確認
const columns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
const hasAnalysis = columns.some(c => c.name === 'analysis_data');

if (hasAnalysis) {
  console.log('✅ analysis_data カラムは既に存在します');
} else {
  db.exec(`ALTER TABLE jobs ADD COLUMN analysis_data TEXT`);
  console.log('✅ analysis_data カラムを追加しました');
}

// 未分析の求人数を表示
const stats = db.prepare(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN analysis_data IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
    SUM(CASE WHEN analysis_data IS NULL AND description IS NOT NULL THEN 1 ELSE 0 END) as analyzable,
    SUM(CASE WHEN description IS NULL THEN 1 ELSE 0 END) as no_description
  FROM jobs WHERE status = 'active'
`).get() as { total: number; analyzed: number; analyzable: number; no_description: number };

console.log(`\n📊 アクティブ求人の分析状況:`);
console.log(`  総数: ${stats.total}`);
console.log(`  分析済み: ${stats.analyzed}`);
console.log(`  分析可能（description あり）: ${stats.analyzable}`);
console.log(`  description なし: ${stats.no_description}`);

db.close();
