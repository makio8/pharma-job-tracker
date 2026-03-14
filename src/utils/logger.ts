/**
 * シンプルなカラーログユーティリティ
 * Node.js の ANSI カラーコードでコンソール出力を色分けする
 */

const COLORS = {
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
} as const;

function timestamp(): string {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

export const logger = {
  /** 情報メッセージ（青） */
  info(message: string): void {
    console.log(
      `${COLORS.blue}[INFO]${COLORS.reset} ${timestamp()} ${message}`,
    );
  },

  /** 成功メッセージ（緑） */
  success(message: string): void {
    console.log(
      `${COLORS.green}[OK]${COLORS.reset}   ${timestamp()} ${message}`,
    );
  },

  /** 警告メッセージ（黄） */
  warn(message: string): void {
    console.warn(
      `${COLORS.yellow}[WARN]${COLORS.reset} ${timestamp()} ${message}`,
    );
  },

  /** エラーメッセージ（赤） */
  error(message: string): void {
    console.error(
      `${COLORS.red}[ERROR]${COLORS.reset} ${timestamp()} ${message}`,
    );
  },

  /** スクレイピング開始ログ */
  scrapeStart(companyId: string): void {
    logger.info(`\u{1F50D} Scraping: ${companyId}...`);
  },

  /** スクレイピング完了ログ */
  scrapeEnd(companyId: string, jobCount: number): void {
    logger.success(`\u2705 ${companyId}: ${jobCount} jobs found`);
  },

  /** スクレイピング失敗ログ */
  scrapeFail(companyId: string, error: string): void {
    logger.error(`\u274C ${companyId}: ${error}`);
  },
};
