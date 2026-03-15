/**
 * MSD Japan スクレイパー
 *
 * MSD（Merck Sharp & Dohme）の日本法人キャリアページからスクレイピング。
 * サイトは Phenom People プラットフォームを使用しており、
 * 検索結果ページに JSON データが `phApp.ddo.eagerLoadRefineSearch.data.jobs` として
 * 埋め込まれている。これを直接抽出する。
 *
 * 1ページ10件で、`from` パラメータでページネーション。
 * `country` フィールドで Japan の求人のみフィルタ。
 * 埋め込みデータに description は含まれない（タイトル・部門・勤務地のみ）。
 *
 * 対象 URL: https://jobs.msd.com/jp/ja/search-results
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
  category?: string;    // 部門名（日本語: "薬事部門", "臨床開発" 等）
  subCategory?: string;
  type?: string;
  postedDate?: string;
  applyUrl?: string;
  descriptionTeaser?: string;
}

export class MsdScraper extends BaseScraper {
  companyId = 'msd';
  readonly url = 'https://jobs.msd.com/jp/ja/search-results';

  /** 最大取得ページ数（10件/ページ × 50 = 500件上限） */
  private readonly maxPages = 50;

  /** MSD のサイトは SPA で networkidle にならないため domcontentloaded を使う */
  protected override get waitUntilStrategy(): 'networkidle' | 'domcontentloaded' | 'load' {
    return 'domcontentloaded';
  }

  async extractJobs(page: Page): Promise<JobListing[]> {
    // domcontentloaded で十分（networkidle は遅いため使わない）
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3_000);

    // ── Phenom の埋め込みデータから求人を抽出 ──
    const allPhenomJobs = await this.extractAllPhenomJobs(page);

    if (allPhenomJobs.length === 0) {
      logger.warn('msd: Phenom 埋め込みデータが見つからないため DOM フォールバックを実行');
      return this.extractFromDom(page);
    }

    logger.info(`msd: Phenom データから全 ${allPhenomJobs.length} 件を取得`);

    // Japan 関連の求人のみフィルタ（country フィールドで直接判定）
    const japanJobs = allPhenomJobs.filter((j) =>
      j.country?.toLowerCase().includes('japan') ||
      j.location?.toLowerCase().includes('japan') ||
      j.cityState?.includes('Tokyo') ||
      j.cityState?.includes('Osaka'),
    );
    logger.info(`msd: Japan フィルタ後 ${japanJobs.length} 件`);

    // JobListing に変換
    return japanJobs.map((pj) => {
      const job: JobListing = {
        title: pj.title || '',
        url: pj.applyUrl || `https://jobs.msd.com/jp/ja/job/${pj.jobSeqNo}`,
        externalId: pj.reqId || pj.jobSeqNo,
        department: pj.category,
        location: pj.location || pj.cityState,
        description: pj.descriptionTeaser || undefined,
      };

      // 自動分類（タイトル + 部門名で精度UP）
      const textForClassify = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(textForClassify);
      job.therapeuticArea = classifyTherapeuticArea(textForClassify);

      return job;
    });
  }

  /**
   * Phenom People の埋め込み JSON データを全ページ分取得する。
   * totalHits が埋め込みデータに含まれないため、空ページが返るまでページネーションを続ける。
   */
  private async extractAllPhenomJobs(page: Page): Promise<PhenomJob[]> {
    // 1ページ目
    const firstPageJobs = await this.extractPhenomJobsFromPage(page);
    if (firstPageJobs.length === 0) return [];

    const allJobs: PhenomJob[] = [...firstPageJobs];
    const pageSize = firstPageJobs.length; // 通常10

    logger.info(`msd: 1ページ目 ${pageSize} 件を取得`);

    // ページネーション: 空ページが返るまで or maxPages まで
    for (let pageNum = 1; pageNum < this.maxPages; pageNum++) {
      const fromOffset = pageNum * pageSize;

      let nextPage: Page | null = null;
      try {
        nextPage = await page.context().newPage();
        await nextPage.goto(
          `${this.url}?from=${fromOffset}&s=1`,
          { timeout: 30_000, waitUntil: 'domcontentloaded' },
        );
        await nextPage.waitForTimeout(2_000);

        const pageJobs = await this.extractPhenomJobsFromPage(nextPage);

        if (pageJobs.length === 0) {
          logger.info(`msd: ページ ${pageNum + 1} で空結果 → ページネーション終了（累計 ${allJobs.length} 件）`);
          break;
        }

        allJobs.push(...pageJobs);
        logger.info(`msd: ページ ${pageNum + 1} - ${pageJobs.length} 件（累計 ${allJobs.length} 件）`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`msd: ページ ${pageNum + 1} の取得失敗: ${msg}`);
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

  /**
   * DOM フォールバック: Phenom データが取得できない場合
   */
  private async extractFromDom(page: Page): Promise<JobListing[]> {
    await page.waitForLoadState('networkidle').catch(() => {});

    const jobLinks = await page.evaluate(() => {
      const results: Array<{
        title: string;
        url: string;
        externalId?: string;
        location?: string;
        department?: string;
      }> = [];

      const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/job/"]');
      for (let i = 0; i < links.length; i++) {
        const link = links[i];
        if (link.closest('nav, header, footer')) continue;

        const title = link.textContent?.trim() || '';
        if (!title || title.length < 5) continue;

        const href = link.href;
        const match = href.match(/\/job\/([^/]+)/);

        const card = link.closest('[class*="card"], [class*="item"], li, article') || link.parentElement;
        const location = card?.querySelector('[class*="location"], [class*="city"]')?.textContent?.trim();
        const department = card?.querySelector('[class*="category"], [class*="department"]')?.textContent?.trim();

        results.push({ title, url: href, externalId: match?.[1], location, department });
      }
      return results;
    });

    logger.info(`msd: DOM フォールバックで ${jobLinks.length} 件検出`);

    return jobLinks.map((link) => {
      const job: JobListing = {
        title: link.title,
        url: link.url,
        externalId: link.externalId,
        location: link.location,
        department: link.department,
      };
      const text = `${job.title} ${job.department ?? ''}`;
      job.jobCategory = classifyJobCategory(text);
      job.therapeuticArea = classifyTherapeuticArea(text);
      return job;
    });
  }
}

// ── MSD インスタンス ──────────────────────────────
export const msdScraper = new MsdScraper();
