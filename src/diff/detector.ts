/**
 * DiffDetector - スクレイピング結果と DB の差分を検出・適用する
 */

import { dbClient, type Job, type JobInput } from '../db/client.js';
import type { JobListing } from '../scrapers/base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../config.js';
import { logger } from '../utils/logger.js';

// ── 型定義 ────────────────────────────────────────

/** 差分検出の結果 */
export interface DiffResult {
  companyId: string;
  newJobs: JobListing[];       // 新規求人（スクレイピング結果）
  closedJobs: Job[];           // 終了した求人（DB の行）
  continuedCount: number;      // 継続中の求人数
  totalActive: number;         // 現在のアクティブ求人総数
}

// ── DiffDetector クラス ──────────────────────────

export class DiffDetector {
  /**
   * DB 上のアクティブ求人とスクレイピング結果を比較し、差分を返す
   *
   * マッチング戦略:
   *   1. external_id が一致 → 同一求人
   *   2. title + url が一致 → 同一求人
   *
   * @param companyId   - 企業ID
   * @param scrapedJobs - 今回スクレイピングで取得した求人一覧
   */
  detectDiff(companyId: string, scrapedJobs: JobListing[]): DiffResult {
    // DB から当該企業のアクティブ求人を取得
    const activeDbJobs = dbClient.getActiveJobs(companyId);

    // マッチング用インデックスを構築
    const dbByExternalId = new Map<string, Job>();
    const dbByTitleUrl = new Map<string, Job>();
    for (const job of activeDbJobs) {
      if (job.external_id) {
        dbByExternalId.set(job.external_id, job);
      }
      dbByTitleUrl.set(`${job.title}|||${job.url ?? ''}`, job);
    }

    const matchedDbIds = new Set<number>();
    const newJobs: JobListing[] = [];
    let continuedCount = 0;

    for (const scraped of scrapedJobs) {
      // 1) external_id でマッチ
      let matched: Job | undefined;
      if (scraped.externalId) {
        matched = dbByExternalId.get(scraped.externalId);
      }
      // 2) title + url でマッチ
      if (!matched) {
        matched = dbByTitleUrl.get(`${scraped.title}|||${scraped.url ?? ''}`);
      }

      if (matched) {
        // 継続中
        matchedDbIds.add(matched.id);
        continuedCount++;
      } else {
        // 新規
        newJobs.push(scraped);
      }
    }

    // DB にあるがスクレイピング結果に無い → 終了（closed）
    const closedJobs = activeDbJobs.filter(
      (j) => !matchedDbIds.has(j.id),
    );

    return {
      companyId,
      newJobs,
      closedJobs,
      continuedCount,
      totalActive: scrapedJobs.length,
    };
  }

  /**
   * 検出した差分を DB に適用する
   *
   * - 新規求人を upsert（自動分類付き）
   * - 継続求人の last_seen を更新
   * - 終了求人の status を 'closed' に更新
   * - daily_snapshots に当日の記録を保存
   *
   * @param companyId   - 企業ID
   * @param scrapedJobs - 今回スクレイピングで取得した求人一覧（継続分も含む）
   * @param diff        - detectDiff() の結果
   * @param scanDate    - スキャン日 ('YYYY-MM-DD')
   */
  applyDiff(
    companyId: string,
    scrapedJobs: JobListing[],
    diff: DiffResult,
    scanDate: string,
  ): void {
    // ── 新規求人を upsert（自動分類付き） ──
    for (const job of diff.newJobs) {
      const category = classifyJobCategory(job.title);
      const textForArea = `${job.title} ${job.description ?? ''}`;
      const area = classifyTherapeuticArea(textForArea);

      const input: JobInput = {
        external_id: job.externalId,
        title: job.title,
        department: job.department,
        location: job.location,
        job_category: category || job.jobCategory,
        url: job.url,
        description: job.description,
        requirements: job.requirements,
        therapeutic_area: area || job.therapeuticArea,
      };

      dbClient.upsertJob(companyId, input);
    }

    // ── 継続求人の last_seen を更新 ──
    // scrapedJobs のうち newJobs でないもの = 継続分
    const newSet = new Set(diff.newJobs);
    for (const job of scrapedJobs) {
      if (newSet.has(job)) continue; // 新規は上で処理済み

      const category = classifyJobCategory(job.title);
      const textForArea = `${job.title} ${job.description ?? ''}`;
      const area = classifyTherapeuticArea(textForArea);

      const input: JobInput = {
        external_id: job.externalId,
        title: job.title,
        department: job.department,
        location: job.location,
        job_category: category || job.jobCategory,
        url: job.url,
        description: job.description,
        requirements: job.requirements,
        therapeutic_area: area || job.therapeuticArea,
      };

      dbClient.upsertJob(companyId, input);
    }

    // ── 終了求人を closed に更新 ──
    if (diff.closedJobs.length > 0) {
      const closedIds = diff.closedJobs
        .filter((j) => j.external_id != null)
        .map((j) => j.external_id!);

      if (closedIds.length > 0) {
        // closeJobs は activeExternalIds 以外を閉じるので、直接 DB 更新する
        const db = dbClient.getDb();
        const closeStmt = db.prepare(
          `UPDATE jobs SET status = 'closed', last_seen = ?, updated_at = datetime('now') WHERE id = ?`,
        );
        for (const job of diff.closedJobs) {
          closeStmt.run(scanDate, job.id);
        }
      } else {
        // external_id が無い求人の場合も直接 id で閉じる
        const db = dbClient.getDb();
        const closeStmt = db.prepare(
          `UPDATE jobs SET status = 'closed', last_seen = ?, updated_at = datetime('now') WHERE id = ?`,
        );
        for (const job of diff.closedJobs) {
          closeStmt.run(scanDate, job.id);
        }
      }
    }

    // ── daily_snapshots に記録 ──
    dbClient.saveDailySnapshot(
      companyId,
      scanDate,
      diff.totalActive,
      diff.newJobs.length,
      diff.closedJobs.length,
    );

    logger.info(
      `${companyId}: 新着${diff.newJobs.length} / 終了${diff.closedJobs.length} / 継続${diff.continuedCount} / 合計${diff.totalActive}`,
    );
  }
}
