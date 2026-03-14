/**
 * リトライユーティリティ
 * 非同期関数を指数バックオフ付きでリトライする
 */

import { logger } from './logger.js';

export interface RetryOptions {
  /** リトライ回数（デフォルト 3） */
  retries?: number;
  /** 基本待機時間（ミリ秒、デフォルト 10000） */
  delay?: number;
  /** ログ表示用のラベル */
  label?: string;
}

/**
 * 非同期関数をリトライ付きで実行する
 *
 * @param fn - 実行する非同期関数
 * @param options - リトライ設定
 * @returns fn の戻り値
 * @throws 全リトライ失敗時は最後のエラーをそのまま throw
 *
 * @example
 * ```ts
 * const data = await withRetry(() => fetchData(url), {
 *   retries: 3,
 *   delay: 5000,
 *   label: 'fetchData',
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, delay = 10_000, label = 'operation' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);

      if (attempt < retries) {
        const waitMs = delay * attempt; // 指数バックオフ（線形増加）
        logger.warn(
          `${label}: attempt ${attempt}/${retries} failed — ${message}. ` +
            `Retrying in ${(waitMs / 1000).toFixed(0)}s...`,
        );
        await sleep(waitMs);
      } else {
        logger.error(
          `${label}: all ${retries} attempts failed — ${message}`,
        );
      }
    }
  }

  throw lastError;
}

/** 指定ミリ秒だけ待つ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
