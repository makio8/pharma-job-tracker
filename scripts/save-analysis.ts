/**
 * 分析結果を DB に保存する
 *
 * 実行: npx tsx scripts/save-analysis.ts < analysis.json
 * または: echo '[{"id":1,"analysis":{...}}]' | npx tsx scripts/save-analysis.ts
 *
 * 入力 JSON 形式:
 * [
 *   {
 *     "id": 123,
 *     "analysis": {
 *       "experience_years_min": 3,
 *       "english_required": true,
 *       "english_level": "business",
 *       "job_level": "senior",
 *       "key_skills": ["GCP", "SAS"],
 *       "clinical_phase": "Phase III",
 *       "work_style": "hybrid",
 *       "attractive_points": "グローバルプロジェクト経験可"
 *     }
 *   }
 * ]
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'pharma-jobs.db');

// stdin からJSON を読み取る
let input: string;
if (process.argv[2]) {
  // ファイルパスが引数で渡された場合
  input = readFileSync(process.argv[2], 'utf-8');
} else {
  // stdin から読み取る
  input = readFileSync('/dev/stdin', 'utf-8');
}

interface AnalysisEntry {
  id: number;
  analysis: Record<string, unknown>;
}

let entries: AnalysisEntry[];
try {
  entries = JSON.parse(input);
  if (!Array.isArray(entries)) {
    throw new Error('入力は配列である必要があります');
  }
} catch (err) {
  console.error('❌ JSON パースエラー:', (err as Error).message);
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const updateStmt = db.prepare(`
  UPDATE jobs SET analysis_data = ?, updated_at = datetime('now')
  WHERE id = ?
`);

const saveAll = db.transaction((items: AnalysisEntry[]) => {
  let success = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const json = JSON.stringify(item.analysis);
      const result = updateStmt.run(json, item.id);
      if (result.changes > 0) {
        success++;
      } else {
        console.warn(`⚠️  ID ${item.id} が見つかりません`);
        failed++;
      }
    } catch (err) {
      console.error(`❌ ID ${item.id} の保存に失敗:`, (err as Error).message);
      failed++;
    }
  }
  return { success, failed };
});

const result = saveAll(entries);
console.log(`✅ 分析結果を保存しました: ${result.success}件成功 / ${result.failed}件失敗`);

db.close();
