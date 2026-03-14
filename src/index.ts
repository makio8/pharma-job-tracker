#!/usr/bin/env npx tsx

/**
 * pharma-job-tracker メインエントリーポイント
 *
 * Usage:
 *   npm run scrape                          -> 全社スクレイピング + 差分検出 + X投稿
 *   npm run scrape -- --company eisai       -> 特定企業のみ
 *   npm run scrape -- --dry-run             -> X投稿なし（スクレイピングのみ）
 *   npm run scrape -- --company takeda --dry-run
 */

import { chromium } from 'playwright';
import { BaseScraper, type ScraperResult } from './scrapers/base.js';
import { dbClient } from './db/client.js';
import { DiffDetector, type DiffResult } from './diff/detector.js';
import { SCRAPE_CONFIG } from './config.js';
import { logger } from './utils/logger.js';

// ── スクレイパーのインポート ──────────────────────
import { eisaiScraper, kyowakirinScraper } from './scrapers/hrmos.js';
import { takedaScraper, pfizerScraper } from './scrapers/workday.js';
import { chugaiScraper } from './scrapers/jposting.js';
import { msdScraper } from './scrapers/custom/msd.js';

// ── スクレイパーレジストリ ────────────────────────
// 企業ID → スクレイパーインスタンスのマッピング
const SCRAPERS: Record<string, BaseScraper> = {
  eisai: eisaiScraper,
  kyowakirin: kyowakirinScraper,
  takeda: takedaScraper,
  pfizer: pfizerScraper,
  chugai: chugaiScraper,
  msd: msdScraper,
};

// ── 型定義 ────────────────────────────────────────

interface CompanyResult {
  companyId: string;
  diff: DiffResult;
  result: ScraperResult;
}

// ── メイン処理 ────────────────────────────────────

async function main(): Promise<void> {
  const startTime = Date.now();

  // CLI 引数のパース
  const args = process.argv.slice(2);
  const companyArg = getArgValue(args, '--company');
  const isDryRun = args.includes('--dry-run');

  // 対象企業の決定
  let targetCompanies: string[];
  if (companyArg) {
    if (!SCRAPERS[companyArg]) {
      logger.error(
        `不明な企業ID: "${companyArg}"\n` +
        `利用可能な企業: ${Object.keys(SCRAPERS).join(', ')}`,
      );
      process.exit(1);
    }
    targetCompanies = [companyArg];
  } else {
    targetCompanies = Object.keys(SCRAPERS);
  }

  logger.info('pharma-job-tracker 起動');
  logger.info(`対象企業: ${targetCompanies.join(', ')}`);
  if (isDryRun) logger.info('dry-run モード（X投稿なし）');

  // ブラウザ起動
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: SCRAPE_CONFIG.userAgent,
  });

  const detector = new DiffDetector();
  const scanDate = new Date().toISOString().slice(0, 10);
  const allResults: CompanyResult[] = [];
  const errors: Array<{ companyId: string; error: string }> = [];

  try {
    // ── 各企業をスクレイピング ──
    for (const companyId of targetCompanies) {
      const scraper = SCRAPERS[companyId];
      if (!scraper) {
        logger.warn(`スクレイパー未実装: ${companyId}`);
        continue;
      }

      const page = await context.newPage();
      try {
        const result = await scraper.scrape(page);

        if (result.success && result.jobs.length > 0) {
          // 差分検出 → DB 適用
          const diff = detector.detectDiff(companyId, result.jobs);
          detector.applyDiff(companyId, result.jobs, diff, scanDate);
          allResults.push({ companyId, diff, result });
        } else if (!result.success) {
          errors.push({
            companyId,
            error: result.error ?? '不明なエラー',
          });
        } else {
          logger.warn(`${companyId}: 求人が0件でした`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`${companyId}: 予期しないエラー - ${message}`);
        errors.push({ companyId, error: message });
      } finally {
        await page.close();
      }
    }

    // ── 結果サマリー ──
    logger.info('');
    logger.info('--- スクレイピング結果サマリー ---');
    for (const { companyId, diff } of allResults) {
      logger.info(
        `  ${companyId}: 合計${diff.totalActive}件` +
        ` (新規+${diff.newJobs.length} / 終了-${diff.closedJobs.length} / 継続${diff.continuedCount})`,
      );
    }
    if (errors.length > 0) {
      logger.warn('--- エラー ---');
      for (const { companyId, error } of errors) {
        logger.error(`  ${companyId}: ${error}`);
      }
    }

    // ── X投稿（dry-run でなければ） ──
    if (!isDryRun && allResults.length > 0) {
      try {
        // posting/client.ts の実装が完了次第ここで呼び出す
        // const { postDailySummary } = await import('./posting/client.js');
        // await postDailySummary(allResults);
        logger.info('X投稿: 未実装（スキップ）');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`X投稿エラー: ${message}`);
      }
    }
  } finally {
    // リソースの確実な解放
    await browser.close();
    dbClient.close();
  }

  // ── 実行時間 ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.success(`完了 (${elapsed}秒)`);
}

// ── ヘルパー関数 ──────────────────────────────────

/**
 * CLI 引数から --flag value 形式の値を取得する
 * @param args - process.argv.slice(2) の配列
 * @param flag - フラグ名（例: '--company'）
 * @returns フラグの値。無ければ undefined
 */
function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// ── エントリーポイント ────────────────────────────

main().catch((err) => {
  logger.error(`致命的エラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
