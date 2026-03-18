/**
 * description バックフィルスクリプト
 *
 * DB にある description が NULL のアクティブ求人を Playwright で開いて
 * 募集要項を取得し、DB に保存する。
 *
 * 全社横断で使える汎用スクリプト。スクレイパー個別修正不要。
 *
 * 実行: npx tsx scripts/backfill-descriptions.ts [--limit N] [--company ID]
 */

import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'pharma-jobs.db');

// CLI 引数
const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) || 20 : 20;
const companyIdx = args.indexOf('--company');
const companyFilter = companyIdx !== -1 ? args[companyIdx + 1] : null;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// description が NULL のアクティブ求人を取得
let sql = `
  SELECT id, company_id, title, url
  FROM jobs
  WHERE status = 'active'
    AND (description IS NULL OR length(description) <= 50)
    AND url IS NOT NULL
    AND url != ''
`;
const params: unknown[] = [];

if (companyFilter) {
  sql += ` AND company_id = ?`;
  params.push(companyFilter);
}
sql += ` ORDER BY company_id, id LIMIT ?`;
params.push(limit);

interface JobRow {
  id: number;
  company_id: string;
  title: string;
  url: string;
}

const jobs = db.prepare(sql).all(...params) as JobRow[];

if (jobs.length === 0) {
  console.log('✅ バックフィル対象の求人はありません');
  db.close();
  process.exit(0);
}

console.log(`📋 バックフィル対象: ${jobs.length}件`);
jobs.forEach(j => console.log(`  - [${j.company_id}] ${j.title.slice(0, 60)}`));

// Playwright でブラウザを起動
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});

const updateStmt = db.prepare(`
  UPDATE jobs SET description = ?, requirements = COALESCE(requirements, ?), updated_at = datetime('now')
  WHERE id = ?
`);

let success = 0;
let failed = 0;

for (const job of jobs) {
  let page = null;
  try {
    page = await context.newPage();

    // Workday SPA の場合は networkidle で待つ（他は domcontentloaded で十分）
    const isWorkday = job.url.includes('myworkdayjobs.com');
    const waitStrategy = isWorkday ? 'networkidle' as const : 'domcontentloaded' as const;
    await page.goto(job.url, { timeout: 30_000, waitUntil: waitStrategy });

    // Workday は SPA レンダリング完了を待つ
    if (isWorkday) {
      await page.waitForSelector('[data-automation-id="jobPostingDescription"], [data-automation-id="jobPostingHeader"]', { timeout: 10_000 }).catch(() => {});
    }
    await page.waitForTimeout(2_000);

    const detail = await page.evaluate(() => {
      let description: string | null = null;
      let requirements: string | null = null;

      // === Strategy 0: JSON-LD (Schema.org JobPosting) ===
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (let i = 0; i < jsonLdScripts.length; i++) {
        try {
          const data = JSON.parse(jsonLdScripts[i].textContent || '');
          const posting = data['@type'] === 'JobPosting' ? data : null;
          if (posting?.description) {
            const tmp = document.createElement('div');
            tmp.innerHTML = posting.description;
            description = tmp.textContent?.trim() || null;
          }
          if (posting?.qualifications) {
            const tmp = document.createElement('div');
            tmp.innerHTML = posting.qualifications;
            requirements = tmp.textContent?.trim() || null;
          }
        } catch { /* ignore */ }
      }

      // === Strategy 1: Workday 詳細ページ ===
      if (!description) {
        const wdDesc = document.querySelector('[data-automation-id="jobPostingDescription"]');
        if (wdDesc?.textContent?.trim()) {
          description = wdDesc.textContent.trim();
        }
      }

      // === Strategy 2: 求人系セレクタ ===
      if (!description) {
        const selectors = [
          '[class*="job-description"]', '[class*="jd-info"]', '#job-description',
          '.job-detail', '[class*="jtbd-description"]',
          '[class*="description"]', '[class*="detail"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim() && el.textContent.trim().length > 100) {
            description = el.textContent.trim();
            break;
          }
        }
      }

      // === Strategy 3: メインコンテンツ フォールバック ===
      if (!description) {
        const main = document.querySelector('main, article, [role="main"], #content, .content, [class*="content"]');
        if (main) {
          const clone = main.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('nav, header, footer, script, style, button, form, [class*="nav"], [class*="footer"], [class*="apply"]').forEach(el => el.remove());
          const text = clone.textContent?.trim();
          if (text && text.length > 100) {
            description = text;
          }
        }
      }

      // === 応募要件 ===
      if (!requirements) {
        const reqSelectors = [
          '[class*="qualification"]', '[class*="requirement"]',
          '[class*="jtbd-qualification"]',
        ];
        for (const sel of reqSelectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim() && el.textContent.trim().length > 50) {
            requirements = el.textContent.trim();
            break;
          }
        }
      }

      return {
        description: description?.slice(0, 5000) || null,
        requirements: requirements?.slice(0, 3000) || null,
      };
    });

    if (detail.description) {
      updateStmt.run(detail.description, detail.requirements, job.id);
      console.log(`✅ [${job.company_id}] ${job.title.slice(0, 50)} (${detail.description.length}文字)`);
      success++;
    } else {
      console.log(`⚠️  [${job.company_id}] ${job.title.slice(0, 50)} — 取得できず`);
      failed++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`❌ [${job.company_id}] ${job.title.slice(0, 50)} — ${msg.slice(0, 80)}`);
    failed++;
  } finally {
    if (page) { try { await page.close(); } catch { /* ignore */ } }
  }
}

await browser.close();
db.close();

console.log(`\n📊 バックフィル結果: ${success}件成功 / ${failed}件失敗 / ${jobs.length}件中`);
