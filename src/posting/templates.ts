/**
 * X (Twitter) 投稿テンプレート
 * 各テンプレートは280文字以内のツイート本文を生成する
 */

import { POST_CONFIG } from '../config.js';

const HASHTAGS = POST_CONFIG.hashtags.default.join(' ');
const MAX_LEN = POST_CONFIG.maxTweetLength;

/** 末尾を切り詰めて最大文字数に収める */
function truncate(text: string, maxLen: number = MAX_LEN): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

// ── 日次サマリー ──────────────────────────────────

export interface DailySummaryData {
  date: string;               // '3/14' 形式
  foreignTotal: number;       // 外資アクティブ求人数
  foreignNew: number;         // 外資 新着
  foreignClosed: number;      // 外資 終了
  domesticTotal: number;      // 内資アクティブ求人数
  domesticNew: number;        // 内資 新着
  domesticClosed: number;     // 内資 終了
  highlights: Array<{ company: string; title: string }>; // 最大2件
}

export function dailySummaryTemplate(data: DailySummaryData): string {
  const {
    date,
    foreignTotal, foreignNew, foreignClosed,
    domesticTotal, domesticNew, domesticClosed,
    highlights,
  } = data;

  const lines: string[] = [
    `📊 製薬キャリアDaily ${date}`,
    '',
    `🌍外資: ${foreignTotal}件 (▲${foreignNew} ▼${foreignClosed})`,
    `🇯🇵内資: ${domesticTotal}件 (▲${domesticNew} ▼${domesticClosed})`,
  ];

  if (highlights.length > 0) {
    lines.push('');
    lines.push('🆕注目:');
    for (const h of highlights.slice(0, 2)) {
      lines.push(`・${h.company} ${h.title}`);
    }
  }

  lines.push('');
  lines.push(HASHTAGS);

  return truncate(lines.join('\n'));
}

// ── 新着ハイライト ────────────────────────────────

export interface NewJobData {
  companyName: string;
  title: string;
  location?: string;
  category?: string;
}

export function newJobTemplate(data: NewJobData): string {
  const { companyName, title, location, category } = data;

  const lines: string[] = [
    `🆕 新着求人`,
    '',
    `🏢 ${companyName}`,
    `📋 ${title}`,
  ];

  if (location) lines.push(`📍 ${location}`);
  if (category) lines.push(`🏷️ ${category}`);

  lines.push('');
  lines.push(HASHTAGS);

  return truncate(lines.join('\n'));
}

// ── 週次トレンド ──────────────────────────────────

export interface WeeklyTrendData {
  dateRange: string;          // '3/10-3/14' 形式
  totalNew: number;
  totalClosed: number;
  topCompany: { name: string; count: number };
  categoryBreakdown: Array<{ category: string; percentage: number }>; // top 3
}

export function weeklyTrendTemplate(data: WeeklyTrendData): string {
  const { dateRange, totalNew, totalClosed, topCompany, categoryBreakdown } = data;

  const lines: string[] = [
    `📈 週次トレンド ${dateRange}`,
    '',
    `新着 ${totalNew}件 / 終了 ${totalClosed}件`,
    `🏆 最多掲載: ${topCompany.name}(${topCompany.count}件)`,
  ];

  if (categoryBreakdown.length > 0) {
    lines.push('');
    for (const cat of categoryBreakdown.slice(0, 3)) {
      lines.push(`・${cat.category} ${cat.percentage}%`);
    }
  }

  lines.push('');
  lines.push(HASHTAGS);

  return truncate(lines.join('\n'));
}
