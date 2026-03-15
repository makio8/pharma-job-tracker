/**
 * Roche スクレイパー
 *
 * Roche のキャリアサイトは Phenom People プラットフォームを使用（MSD と同じ）。
 * `phApp.ddo.eagerLoadRefineSearch.data.jobs` に埋め込まれた JSON データから求人を抽出する。
 *
 * バックエンドは Workday（roche-ext テナント）だが、
 * フロントエンドは Phenom で求人検索UIを提供。
 *
 * 対象 URL: https://careers.roche.com/global/en/search-results?keywords=japan
 */

import { Page } from 'playwright';
import { BaseScraper, type JobListing } from '../base.js';
import { classifyJobCategory, classifyTherapeuticArea } from '../../config.js';
import { logger } from '../../utils/logger.js';

// ── Phenom People の埋め込みデータ型 ──

interface PhenomJob {
  title?: string;
  jobSeqNo?: string;
  reqId?: string;
  location?: string;
  cityState?: string;
  country?: string;
  category?: string;
  subCategory?: string;
  type?: string;
  postedDate?: string;
  applyUrl?: string;
  descriptionTeaser?: string;
}

export class RocheScraper extends BaseScraper {
  companyId = 'roche';
  readonly url = 'https://careers.roche.com/global/en/search-results?keywords=japan';

  /** 最大取得ページ数（10件/ページ × 50 = 500件上限） */
  private readonly maxPages = 50;

  /** SPA なので domcontentloaded を使う */
  protected override get waitUntilStrategy(): 'networkidle' | 'domcontentloaded' | 'load' {
    return 'domcontentloaded';
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    // ── Phenom の埋め込みデータから求人を抽出 ──
    const allPhenomJobs = await this.extractAllPhenomJobs(page);

    if (allPhenomJobs.length === 0) {
      logger.warn('roche: Phenom 埋め込みデータが見つかりません');
      return [];
    }

    logger.info(`roche: Phenom データから全 ${allPhenomJobs.length} 件を取得`);

    // Japan 関連の求人のみフィルタ
    const japanJobs = allPhenomJobs.filter((j) =>
      j.country?.toLowerCase().includes('japan') ||
      j.location?.toLowerCase().includes('japan') ||
      j.cityState?.includes('Tokyo') ||
      j.cityState?.includes('Osaka'),
    );
    logger.info(`roche: Japan フィルタ後 ${japanJobs.length} 件`);

    // JobListing に変換
    return japanJobs.map((pj) => {
      const job: JobListing = {
        title: pj.title || '',
        url: pj.applyUrl || `https://careers.roche.com/global/en/job/${pj.jobSeqNo}`,
        externalId: pj.reqId || pj.jobSeqNo,
        department: pj.category,
        location: pj.location || pj.cityState,
        description: pj.descriptionTeaser || undefined,
      };

      const textForClassify = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(textForClassify);
      job.therapeuticArea = classifyTherapeuticArea(textForClassify);

      return job;
    });
  }

  /**
   * Phenom People の埋め込み JSON データを全ページ分取得する。
   */
  private async extractAllPhenomJobs(page: Page): Promise<PhenomJob[]> {
    const firstPageJobs = await this.extractPhenomJobsFromPage(page);
    if (firstPageJobs.length === 0) return [];

    const allJobs: PhenomJob[] = [...firstPageJobs];
    const pageSize = firstPageJobs.length;

    logger.info(`roche: 1ページ目 ${pageSize} 件を取得`);

    for (let pageNum = 1; pageNum < this.maxPages; pageNum++) {
      const fromOffset = pageNum * pageSize;

      let nextPage: Page | null = null;
      try {
        nextPage = await page.context().newPage();
        await nextPage.goto(
          `${this.url}&from=${fromOffset}&s=1`,
          { timeout: 30_000, waitUntil: 'domcontentloaded' },
        );
        await nextPage.waitForTimeout(2_000);

        const pageJobs = await this.extractPhenomJobsFromPage(nextPage);

        if (pageJobs.length === 0) {
          logger.info(`roche: ページ ${pageNum + 1} で空結果 → ページネーション終了（累計 ${allJobs.length} 件）`);
          break;
        }

        allJobs.push(...pageJobs);
        logger.info(`roche: ページ ${pageNum + 1} - ${pageJobs.length} 件（累計 ${allJobs.length} 件）`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`roche: ページ ${pageNum + 1} の取得失敗: ${msg}`);
        break;
      } finally {
        if (nextPage) {
          try { await nextPage.close(); } catch { /* ignore */ }
        }
      }
    }

    return allJobs;
  }

  /** 1ページ分の Phenom 埋め込みデータを取得 */
  private async extractPhenomJobsFromPage(p: Page): Promise<PhenomJob[]> {
    return p.evaluate(() => {
      try {
        const w = window as unknown as Record<string, unknown>;
        const phApp = w.phApp as Record<string, unknown> | undefined;
        if (!phApp) return [];
        const ddo = phApp.ddo as Record<string, unknown> | undefined;
        if (!ddo) return [];
        const eagerLoad = ddo.eagerLoadRefineSearch as Record<string, unknown> | undefined;
        if (!eagerLoad) return [];
        const data = eagerLoad.data as { jobs?: unknown[] } | undefined;
        return (data?.jobs || []) as PhenomJob[];
      } catch {
        return [];
      }
    });
  }
}

// ── Roche インスタンス ──────────────────────────────
export const rocheScraper = new RocheScraper();
