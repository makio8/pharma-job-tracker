/**
 * PostFormatter
 * DB クエリ結果をツイート用テキストに変換するフォーマッター
 */

import {
  dailySummaryTemplate,
  newJobTemplate,
  weeklyTrendTemplate,
  type DailySummaryData,
  type NewJobData,
  type WeeklyTrendData,
} from './templates.js';
import { JOB_CATEGORIES, POST_CONFIG, isHighlightWorthy } from '../config.js';

// ── 型定義（DB から取得する行に対応） ──────────────

/** daily_snapshots + companies JOIN の行 */
export interface SnapshotRow {
  company_id: string;
  category: 'foreign' | 'domestic';  // companies.category から JOIN で取得
  scan_date: string;                  // 'YYYY-MM-DD'
  total_jobs: number;
  new_jobs: number;
  closed_jobs: number;
}

/** jobs + companies JOIN の行（投稿用） */
export interface JobRow {
  company_id: string;
  company_name: string;  // companies.name_ja から JOIN で取得
  title: string;
  url?: string;
  location?: string;
  job_category?: string;
  description?: string;
  therapeutic_area?: string;
}

// ── PostFormatter クラス ──────────────────────────

export class PostFormatter {
  /**
   * テキストを指定文字数に収める
   * 末尾に '…' を付けて切り詰める
   */
  truncateToFit(text: string, maxLen: number = POST_CONFIG.maxTweetLength): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }

  // ── 日次サマリー ────────────────────────────────

  /**
   * その日のスナップショット + 新着求人から日次サマリーツイートを生成
   * @param snapshots - 当日の全社スナップショット
   * @param newJobs   - 当日の新着求人リスト
   */
  formatDailySummary(snapshots: SnapshotRow[], newJobs: JobRow[]): string {
    // 外資 / 内資 で集計
    const foreign = snapshots.filter((s) => s.category === 'foreign');
    const domestic = snapshots.filter((s) => s.category === 'domestic');

    const sum = (rows: SnapshotRow[], key: 'total_jobs' | 'new_jobs' | 'closed_jobs') =>
      rows.reduce((acc, r) => acc + r[key], 0);

    // 当日日付を '3/14' 形式に
    const today = snapshots[0]?.scan_date ?? new Date().toISOString().slice(0, 10);
    const [, m, d] = today.split('-');
    const dateStr = `${Number(m)}/${Number(d)}`;

    // 注目求人: ハイライト対象カテゴリからフィルタして最大2件
    // カテゴリの重要度順（配列の前ほど優先）で選ぶ
    const categoryPriority = ['rd', 'clinical', 'medical', 'pv', 'regulatory', 'strategy', 'marketing', 'sales', 'digital', 'mr'];
    const worthyJobs = newJobs.filter((j) =>
      isHighlightWorthy({ title: j.title, jobCategory: j.job_category }),
    );
    const highlights = worthyJobs
      .slice()
      .sort((a, b) => {
        const aIdx = categoryPriority.indexOf(a.job_category ?? '');
        const bIdx = categoryPriority.indexOf(b.job_category ?? '');
        // カテゴリが見つからない場合は末尾扱い
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      })
      .slice(0, 2)
      .map((j) => ({ company: j.company_name, title: j.title }));

    const data: DailySummaryData = {
      date: dateStr,
      foreignTotal: sum(foreign, 'total_jobs'),
      foreignNew: sum(foreign, 'new_jobs'),
      foreignClosed: sum(foreign, 'closed_jobs'),
      domesticTotal: sum(domestic, 'total_jobs'),
      domesticNew: sum(domestic, 'new_jobs'),
      domesticClosed: sum(domestic, 'closed_jobs'),
      highlights,
    };

    return dailySummaryTemplate(data);
  }

  // ── 新着ハイライト ──────────────────────────────

  /**
   * 新着求人をそれぞれ個別ツイートテキストに変換
   * @param newJobs - 新着求人リスト
   * @returns ツイートテキストの配列
   */
  formatNewJobHighlights(newJobs: JobRow[]): string[] {
    // ハイライト対象カテゴリの求人のみに絞る
    const worthyJobs = newJobs.filter((j) =>
      isHighlightWorthy({ title: j.title, jobCategory: j.job_category }),
    );
    return worthyJobs.map((job) => {
      const data: NewJobData = {
        companyName: job.company_name,
        title: job.title,
        location: job.location,
        category: job.job_category
          ? JOB_CATEGORIES[job.job_category] ?? job.job_category
          : undefined,
      };
      return newJobTemplate(data);
    });
  }

  // ── 週次トレンド ────────────────────────────────

  /**
   * 1週間分のスナップショットから週次トレンドツイートを生成
   * @param weekSnapshots - 直近7日分の全社スナップショット
   */
  formatWeeklyTrend(weekSnapshots: SnapshotRow[]): string {
    // 日付範囲
    const dates = [...new Set(weekSnapshots.map((s) => s.scan_date))].sort();
    const first = dates[0] ?? '';
    const last = dates[dates.length - 1] ?? '';
    const fmt = (d: string) => {
      const [, m, day] = d.split('-');
      return `${Number(m)}/${Number(day)}`;
    };
    const dateRange = `${fmt(first)}-${fmt(last)}`;

    // 集計
    const totalNew = weekSnapshots.reduce((a, s) => a + s.new_jobs, 0);
    const totalClosed = weekSnapshots.reduce((a, s) => a + s.closed_jobs, 0);

    // 会社別の新着数ランキング
    const companyNewMap = new Map<string, number>();
    for (const s of weekSnapshots) {
      companyNewMap.set(s.company_id, (companyNewMap.get(s.company_id) ?? 0) + s.new_jobs);
    }
    const topEntry = [...companyNewMap.entries()].sort((a, b) => b[1] - a[1])[0];
    const topCompany = topEntry
      ? { name: topEntry[0], count: topEntry[1] }
      : { name: '-', count: 0 };

    // カテゴリ別の割合（スナップショットからは直接取れないので新着数ベースで近似）
    // NOTE: 正確な内訳が必要な場合は jobs テーブルから集計する拡張が必要
    const categoryBreakdown: Array<{ category: string; percentage: number }> = [];

    const data: WeeklyTrendData = {
      dateRange,
      totalNew,
      totalClosed,
      topCompany,
      categoryBreakdown,
    };

    return weeklyTrendTemplate(data);
  }
}
