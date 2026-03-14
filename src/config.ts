/**
 * pharma-job-tracker 設定ファイル
 * 求人カテゴリ・スクレイピング・投稿の各種設定を管理
 */

// ── 求人カテゴリ定義 ──────────────────────────────
export const JOB_CATEGORIES: Record<string, string> = {
  mr: 'MR（医薬情報担当者）',
  rd: '研究開発',
  clinical: '臨床開発',
  regulatory: '薬事',
  medical: 'メディカルアフェアーズ',
  marketing: 'マーケティング',
  sales: '営業・コマーシャル',
  strategy: '事業戦略・アクセス',
  pv: '安全性（PV）',
  manufacturing: '製造・品質',
  digital: 'DX・デジタル',
  corporate: 'コーポレート',
  other: 'その他',
};

// ── スクレイピング設定 ─────────────────────────────
export const SCRAPE_CONFIG = {
  /** ページ読み込みのタイムアウト（ミリ秒） */
  timeout: 30_000,
  /** リトライ回数 */
  retryCount: 3,
  /** リトライ間隔（ミリ秒） */
  retryDelay: 10_000,
  /** ブラウザの User-Agent 文字列 */
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
} as const;

// ── 投稿（X / Twitter）設定 ────────────────────────
export const POST_CONFIG = {
  /** 日次サマリー投稿時刻（JST） */
  dailySummaryTime: '08:00',
  /** ハッシュタグ */
  hashtags: {
    default: ['#製薬転職', '#MR転職', '#製薬キャリア'],
  },
  /** ツイート最大文字数 */
  maxTweetLength: 280,
} as const;

// ── 疾患領域（Therapeutic Area）定義 ────────────────
export const THERAPEUTIC_AREAS: Record<string, string> = {
  oncology: 'オンコロジー（がん）',
  immunology: '免疫・炎症',
  cns: 'CNS（中枢神経）',
  cardiovascular: '循環器・代謝',
  rare: '希少疾患',
  infectious: '感染症・ワクチン',
  ophthalmology: '眼科',
  hematology: '血液',
  respiratory: '呼吸器',
  gastro: '消化器',
  dermatology: '皮膚科',
  general: '領域横断・不明',
};

/** 疾患領域キーワード → 領域ID のマッピング */
const TA_KEYWORDS: [RegExp, string][] = [
  [/オンコロジー|がん|腫瘍|Oncology|Cancer|抗がん|固形|血液腫瘍|immuno.?oncology|ONC|肺がん|乳がん|大腸|胃がん|肝がん|膵|前立腺|Tumor/i, 'oncology'],
  [/免疫|リウマチ|Immunology|炎症|自己免疫|Autoimmune|IBD|乾癬/i, 'immunology'],
  [/神経|精神|CNS|アルツハイマー|Neuro|パーキンソン|てんかん|Psychiatry/i, 'cns'],
  [/糖尿病|心不全|循環器|Cardiovascular|Metabolic|心臓|高血圧|脂質/i, 'cardiovascular'],
  [/希少|Rare\s?Disease|オーファン|Orphan|遺伝子治療|Gene\s?Therapy/i, 'rare'],
  [/感染症|ワクチン|Infectious|Vaccine|抗菌|HIV|COVID|肝炎/i, 'infectious'],
  [/眼科|Ophthalmology|網膜|緑内障|加齢黄斑/i, 'ophthalmology'],
  [/血液|Hematology|血友病|貧血|骨髄/i, 'hematology'],
  [/呼吸器|Respiratory|喘息|COPD|肺/i, 'respiratory'],
  [/消化器|Gastro|肝臓|GI(?![a-z])/i, 'gastro'],
  [/皮膚|Dermatology|アトピー/i, 'dermatology'],
];

/**
 * 募集要項テキストから疾患領域を推定する
 * タイトル + 本文を結合して検索するとヒット率UP
 * @param text - 求人タイトルや募集要項テキスト
 * @returns 疾患領域ID（例: 'oncology'）。該当なしは 'general'
 */
export function classifyTherapeuticArea(text: string): string {
  for (const [pattern, area] of TA_KEYWORDS) {
    if (pattern.test(text)) {
      return area;
    }
  }
  return 'general';
}

// ── 求人カテゴリ自動分類 ──────────────────────────
/** キーワード → カテゴリID のマッピング（先にマッチした方が優先） */
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/MR|医薬情報/i, 'mr'],
  [/研究|リサーチ|Research|R&D/i, 'rd'],
  [/臨床|Clinical|CRA|CRC|治験|試験|Study\s*Manager|スタディマネ/i, 'clinical'],
  [/薬事|Regulatory|RA(?![a-z])/i, 'regulatory'],
  [/安全性|PV|ファーマコ|Pharmacovigilance|Safety|ICSR|副作用/i, 'pv'],
  [/メディカル|Medical|MSL|メディカルサイエンス|MA(?![a-z])/i, 'medical'],
  [/マーケティング|Marketing|PM(?![a-z])|プロダクトマネ|ブランド|Brand|CRM/i, 'marketing'],
  [/営業|SFE|セールス|Sales|コマーシャル|Commercial|プロモーション/i, 'sales'],
  [/戦略|Strategy|ビジネス|Business\s*Dev|事業開発|アクセス|Access|渉外/i, 'strategy'],
  [/製造|品質|QA|QC|Manufacturing|GMP/i, 'manufacturing'],
  [/デジタル|DX|IT(?![a-z])|データ|Digital|Data|AI(?![a-z])|アナリティクス|Analytics|Insight/i, 'digital'],
  [/人事|経理|法務|総務|HR(?![a-z])|Finance|Legal/i, 'corporate'],
];

/**
 * 求人タイトルからカテゴリIDを推定する
 * @param title - 求人タイトル（日本語 or 英語）
 * @returns カテゴリID（例: 'mr', 'rd' など。該当なしは 'other'）
 */
export function classifyJobCategory(title: string): string {
  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(title)) {
      return category;
    }
  }
  return 'other';
}

/**
 * X投稿のハイライトに含めるべき "注目カテゴリ" かどうかを判定する
 * 工場系・購買系・一般事務系はフィルタアウトする
 */
export function isHighlightWorthy(job: { title: string; jobCategory?: string; department?: string }): boolean {
  // ハイライト対象カテゴリ
  const worthyCategories = ['mr', 'rd', 'clinical', 'regulatory', 'medical', 'marketing', 'digital', 'sales', 'strategy', 'pv'];

  if (job.jobCategory && worthyCategories.includes(job.jobCategory)) return true;

  // other でも戦略系・営業系のタイトルならハイライト対象にする
  const titleText = `${job.title} ${job.department ?? ''}`;
  if (/戦略|Strategy|営業|Sales|マーケ|Market|データ|Data|CRM|Pipeline|パイプライン|MSL|PV|安全性/i.test(titleText)) return true;

  // 工場・購買・倉庫系は明示的に除外
  if (/工場|Plant|保全|Maintenance|購買|Procurement|倉庫|Warehouse|電気計装|ユーティリティ|Utility|清掃/i.test(titleText)) return false;

  return false; // other カテゴリのデフォルトは除外
}
