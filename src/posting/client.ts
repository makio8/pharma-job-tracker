/**
 * XClient - X (Twitter) 投稿クライアント
 *
 * 使い方:
 *   npx tsx src/posting/client.ts            → DB から日次サマリーを生成して投稿
 *   npx tsx src/posting/client.ts --dry-run  → 投稿せずログに出力（テスト用）
 */

import 'dotenv/config';
import { TwitterApi } from 'twitter-api-v2';

// ── XClient クラス ───────────────────────────────

export class XClient {
  private client: TwitterApi;

  constructor(credentials?: {
    appKey: string;
    appSecret: string;
    accessToken: string;
    accessSecret: string;
  }) {
    const creds = credentials ?? {
      appKey: process.env.X_API_KEY ?? '',
      appSecret: process.env.X_API_SECRET ?? '',
      accessToken: process.env.X_ACCESS_TOKEN ?? '',
      accessSecret: process.env.X_ACCESS_SECRET ?? '',
    };

    if (!creds.appKey || !creds.appSecret || !creds.accessToken || !creds.accessSecret) {
      throw new Error(
        'X API 認証情報が不足しています。環境変数 X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET を設定してください',
      );
    }

    this.client = new TwitterApi(creds);
  }

  /**
   * ツイートを投稿する
   * @returns 投稿成功時は { tweetId } を返す。失敗時は null
   */
  async post(text: string): Promise<{ tweetId: string } | null> {
    try {
      const result = await this.client.v2.tweet(text);
      const tweetId = result.data.id;
      console.log(`✅ 投稿成功 (ID: ${tweetId})`);
      return { tweetId };
    } catch (err: unknown) {
      // レートリミット（429）のハンドリング
      if (isRateLimitError(err)) {
        const resetAt = extractRateLimitReset(err);
        const waitSec = resetAt
          ? Math.ceil((resetAt * 1000 - Date.now()) / 1000)
          : 900; // デフォルト15分
        console.error(
          `⚠️ レートリミット到達。リセットまで約${waitSec}秒。投稿をスキップします`,
        );
        return null;
      }

      console.error('❌ 投稿エラー:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /**
   * 日次サマリーを投稿する（または dry-run でログ出力のみ）
   * @param text    - ツイート本文
   * @param dryRun  - true の場合は投稿せずログのみ
   */
  async postDailySummary(
    text: string,
    dryRun: boolean = false,
  ): Promise<{ tweetId: string } | null> {
    console.log('── 日次サマリー ──────────────────');
    console.log(text);
    console.log(`文字数: ${text.length} / 280`);
    console.log('─────────────────────────────────');

    if (dryRun) {
      console.log('🏃 dry-run モード: 投稿はスキップしました');
      return null;
    }

    return this.post(text);
  }
}

// ── ヘルパー ──────────────────────────────────────

function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: number }).code === 429;
  }
  if (err && typeof err === 'object' && 'rateLimit' in err) {
    return true;
  }
  return false;
}

function extractRateLimitReset(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'rateLimit' in err) {
    const rl = (err as { rateLimit: { reset?: number } }).rateLimit;
    return rl?.reset;
  }
  return undefined;
}

// ── CLI エントリーポイント ────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log(`🚀 X 投稿クライアント起動 (dry-run: ${isDryRun})`);

  // DB からデータを取得してフォーマット
  const { dbClient } = await import('../db/client.js');
  const { PostFormatter } = await import('./formatter.js');

  const formatter = new PostFormatter();
  const today = new Date().toISOString().slice(0, 10);

  // 当日のスナップショットを取得（companies テーブルと JOIN して category を取得）
  const snapshots = dbClient.getDb()
    .prepare(`
      SELECT ds.company_id, c.category, ds.scan_date, ds.total_jobs, ds.new_jobs, ds.closed_jobs
      FROM daily_snapshots ds
      JOIN companies c ON ds.company_id = c.id
      WHERE ds.scan_date = ?
    `)
    .all(today) as import('./formatter.js').SnapshotRow[];

  if (snapshots.length === 0) {
    console.log('⚠️ 本日のスナップショットが見つかりません。スクレイピングを先に実行してください');
    return;
  }

  // 当日の新着求人を取得（companies テーブルと JOIN して company_name を取得）
  const newJobs = dbClient.getDb()
    .prepare(`
      SELECT j.company_id, c.name_ja AS company_name, j.title, j.url, j.location,
             j.job_category, j.description, j.therapeutic_area
      FROM jobs j
      JOIN companies c ON j.company_id = c.id
      WHERE j.first_seen = ? AND j.status = 'active'
    `)
    .all(today) as import('./formatter.js').JobRow[];

  const summaryText = formatter.formatDailySummary(snapshots, newJobs);

  // 投稿 or dry-run
  const client = isDryRun ? null : new XClient();
  if (client) {
    await client.postDailySummary(summaryText, isDryRun);
  } else {
    // dry-run の場合は XClient をインスタンス化しない（API キー不要）
    console.log('── 日次サマリー ──────────────────');
    console.log(summaryText);
    console.log(`文字数: ${summaryText.length} / 280`);
    console.log('─────────────────────────────────');
    console.log('🏃 dry-run モード: 投稿はスキップしました');
  }

  // 新着ハイライト（dry-run 時はログのみ）
  if (newJobs.length > 0) {
    const highlights = formatter.formatNewJobHighlights(newJobs.slice(0, 3));
    console.log(`\n📋 新着ハイライト (${highlights.length}件):`);
    for (const h of highlights) {
      console.log('---');
      console.log(h);
      if (!isDryRun && client) {
        await client.post(h);
      }
    }
  }

  console.log('\n✅ 完了');
}

// このファイルが直接実行された場合のみ main() を呼ぶ
// ESM では import.meta.url と process.argv[1] を比較する
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('posting/client.ts') ||
    process.argv[1].endsWith('posting/client.js'));

if (isDirectRun) {
  main().catch((err) => {
    console.error('❌ 致命的エラー:', err);
    process.exit(1);
  });
}
