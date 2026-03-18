/**
 * 未分析の求人を一覧出力する
 *
 * 実行: npx tsx scripts/list-unanalyzed.ts [--limit N] [--company ID]
 * 出力: JSON（Claude Code スキルで読み取り用）
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'pharma-jobs.db');

// CLI 引数
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 10 : 10;
const companyIdx = args.indexOf('--company');
const companyFilter = companyIdx !== -1 ? args[companyIdx + 1] : null;

const db = new Database(DB_PATH, { readonly: true });

let sql = `
  SELECT id, company_id, title, department, location, description, requirements, job_category, therapeutic_area
  FROM jobs
  WHERE status = 'active'
    AND analysis_data IS NULL
    AND description IS NOT NULL
    AND length(description) > 50
`;
const params: unknown[] = [];

if (companyFilter) {
  sql += ` AND company_id = ?`;
  params.push(companyFilter);
}

sql += ` ORDER BY first_seen DESC LIMIT ?`;
params.push(limit);

const jobs = db.prepare(sql).all(...params) as Array<{
  id: number;
  company_id: string;
  title: string;
  department: string | null;
  location: string | null;
  description: string;
  requirements: string | null;
  job_category: string | null;
  therapeutic_area: string | null;
}>;

// description を 2000 文字に制限（トークン節約）
const output = jobs.map(j => ({
  id: j.id,
  company_id: j.company_id,
  title: j.title,
  department: j.department,
  location: j.location,
  description: j.description.slice(0, 2000),
  requirements: j.requirements?.slice(0, 1000) || null,
  current_category: j.job_category,
  current_ta: j.therapeutic_area,
}));

console.log(JSON.stringify(output, null, 2));

db.close();
