/**
 * 共通日本求人フィルタ
 *
 * 全スクレイパーの後段で使用し、locationフィールドを検査して
 * 海外求人（米国・中国など）を除外する。
 *
 * 判定ルール:
 *   - locationが空/null → 通過（国内企業はlocation省略が多い）
 *   - 日本キーワード含む → 通過
 *   - 日本キーワードなし → 除外
 */

import type { JobListing } from '../scrapers/base.js';
import { logger } from './logger.js';

// ── 日本判定キーワード ──────────────────────────

const JAPAN_LOCATION_KEYWORDS = [
  // 英語（都市・県）
  'japan', 'tokyo', 'osaka', 'nagoya', 'kobe', 'kyoto',
  'yokohama', 'fukuoka', 'sapporo', 'hiroshima', 'sendai',
  'chiba', 'kanagawa', 'hyogo', 'aichi', 'saitama', 'ibaraki',
  'shizuoka', 'toyama', 'yamaguchi', 'tochigi', 'gunma',
  'niigata', 'nagano', 'mie', 'shiga', 'nara', 'wakayama',
  'okayama', 'kagawa', 'ehime', 'oita', 'kumamoto', 'miyazaki',
  // 工場・拠点名（各社固有）
  'nishikobe', 'hikari', 'fuji', 'toranomon', 'nihonbashi',
  'sasayama', 'takatsuki', 'tsukuba', 'shonan', 'kamakura',
  'gotemba', 'kakegawa', 'yaizu', 'kawashima',
  // 日本語
  '日本', '東京', '大阪', '名古屋', '神戸', '京都',
  '横浜', '福岡', '札幌', '広島', '仙台',
  '千葉', '神奈川', '兵庫', '愛知', '埼玉', '茨城',
  '静岡', '富山', '山口', '栃木', '群馬', '新潟',
  '長野', '三重', '滋賀', '奈良', '和歌山',
  '岡山', '香川', '愛媛', '大分', '熊本', '宮崎',
  '高槻', 'つくば', '湘南', '鎌倉', '御殿場', '掛川', '焼津',
  '岐阜', '川島', '各務原', '勤務時間',
];

// ── フィルタ関数 ────────────────────────────────

export interface JapanFilterResult {
  /** 日本求人のみ */
  filtered: JobListing[];
  /** 除外された海外求人 */
  removed: JobListing[];
}

/**
 * 求人リストから日本求人のみを抽出する
 */
export function filterJapanJobs(
  jobs: JobListing[],
  companyId: string,
): JapanFilterResult {
  const filtered: JobListing[] = [];
  const removed: JobListing[] = [];

  for (const job of jobs) {
    if (isJapanJob(job)) {
      filtered.push(job);
    } else {
      removed.push(job);
    }
  }

  if (removed.length > 0) {
    logger.warn(
      `${companyId}: 非日本求人を除外 ${removed.length}件/${jobs.length}件`,
    );
    for (const r of removed) {
      logger.info(`  除外: "${r.title}" (location: ${r.location ?? '(空)'})`);
    }
  }

  return { filtered, removed };
}

/**
 * 個別の求人が日本のものかを判定する
 */
function isJapanJob(job: JobListing): boolean {
  const location = (job.location || '').toLowerCase();

  // locationが空 → 通過（国内企業の自社サイトはlocation省略が多い）
  if (!location.trim()) return true;

  return JAPAN_LOCATION_KEYWORDS.some((kw) => location.includes(kw));
}
