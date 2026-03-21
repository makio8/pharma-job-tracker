/**
 * 非日本求人のクリーンアップスクリプト
 *
 * DBの全アクティブ求人のlocationを検査し、
 * 海外求人を status='removed' に変更する。
 *
 * 実行: npx tsx scripts/cleanup-non-japan-jobs.ts [--dry-run]
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'pharma-jobs.db');

const isDryRun = process.argv.includes('--dry-run');

// japan-filter.ts と同じキーワードリスト
const JAPAN_LOCATION_KEYWORDS = [
  'japan', 'tokyo', 'osaka', 'nagoya', 'kobe', 'kyoto',
  'yokohama', 'fukuoka', 'sapporo', 'hiroshima', 'sendai',
  'chiba', 'kanagawa', 'hyogo', 'aichi', 'saitama', 'ibaraki',
  'shizuoka', 'toyama', 'yamaguchi', 'tochigi', 'gunma',
  'niigata', 'nagano', 'mie', 'shiga', 'nara', 'wakayama',
  'okayama', 'kagawa', 'ehime', 'oita', 'kumamoto', 'miyazaki',
  'nishikobe', 'hikari', 'fuji', 'toranomon', 'nihonbashi',
  'sasayama', 'takatsuki', 'tsukuba', 'shonan', 'kamakura',
  'gotemba', 'kakegawa', 'yaizu', 'kawashima',
  '日本', '東京', '大阪', '名古屋', '神戸', '京都',
  '横浜', '福岡', '札幌', '広島', '仙台',
  '千葉', '神奈川', '兵庫', '愛知', '埼玉', '茨城',
  '静岡', '富山', '山口', '栃木', '群馬', '新潟',
  '長野', '三重', '滋賀', '奈良', '和歌山',
  '岡山', '香川', '愛媛', '大分', '熊本', '宮崎',
  '高槻', 'つくば', '湘南', '鎌倉', '御殿場', '掛川', '焼津',
  '岐阜', '川島', '各務原', '勤務時間',
];

function isJapanLocation(location: string | null): boolean {
  if (!location || !location.trim()) return true;
  const lower = location.toLowerCase();
  return JAPAN_LOCATION_KEYWORDS.some((kw) => lower.includes(kw));
}

// ── メイン処理 ──

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const activeJobs = db.prepare(`
  SELECT id, company_id, title, location
  FROM jobs
  WHERE status = 'active'
`).all() as Array<{
  id: number;
  company_id: string;
  title: string;
  location: string | null;
}>;

console.log(`アクティブ求人数: ${activeJobs.length}`);

const nonJapanJobs = activeJobs.filter((j) => !isJapanLocation(j.location));

console.log(`\n非日本求人: ${nonJapanJobs.length}件`);
console.log('---');

// 企業別にグループ化して表示
const byCompany: Record<string, typeof nonJapanJobs> = {};
for (const j of nonJapanJobs) {
  if (!byCompany[j.company_id]) byCompany[j.company_id] = [];
  byCompany[j.company_id].push(j);
}

for (const [companyId, jobs] of Object.entries(byCompany)) {
  console.log(`\n${companyId}: ${jobs.length}件`);
  for (const j of jobs) {
    console.log(`  ID ${j.id}: "${j.title}" (location: ${j.location ?? '(空)'})`);
  }
}

if (isDryRun) {
  console.log('\n[dry-run] 変更は行いません');
} else if (nonJapanJobs.length > 0) {
  const updateStmt = db.prepare(`
    UPDATE jobs SET status = 'closed', updated_at = datetime('now')
    WHERE id = ?
  `);

  const removeAll = db.transaction((ids: number[]) => {
    let count = 0;
    for (const id of ids) {
      const result = updateStmt.run(id);
      count += result.changes;
    }
    return count;
  });

  const removed = removeAll(nonJapanJobs.map((j) => j.id));
  console.log(`\n✅ ${removed}件を removed に変更しました`);
} else {
  console.log('\n✅ 非日本求人は見つかりませんでした');
}

db.close();
