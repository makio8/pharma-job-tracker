/**
 * 企業コンテキスト型定義
 *
 * 各社の製品・パイプライン・業績・文化を構造化して持つ。
 * data/company-context/{company_id}.json に1社1ファイルで格納。
 * 転職者向けの求人ブリーフ生成時に参照される。
 */

/** 製品のステータス */
export type ProductStatus = 'growth' | 'peak' | 'declining' | 'loe_risk';

/** パイプラインのフェーズ */
export type PipelinePhase = 'preclinical' | 'phase1' | 'phase2' | 'phase3' | 'filed' | 'approved_recent';

/** 求人ブリーフのシグナル（求人の温度感） */
export type ContextSignal = 'hot' | 'growing' | 'stable' | 'caution';

/** 主力製品 */
export interface KeyProduct {
  name: string;              // "オプジーボ"
  generic_name: string;      // "nivolumab"
  therapeutic_area: string;  // config.ts の THERAPEUTIC_AREAS キーに対応
  indication: string;        // "非小細胞肺がん、腎細胞がん 等"
  annual_revenue_jpy_b: number | null;  // 日本売上（10億円）
  patent_expiry: string | null;         // "2028" or null
  status: ProductStatus;
  note: string;              // "バイオシミラー参入で2027年以降縮小見込み"
}

/** 新薬パイプライン */
export interface PipelineItem {
  compound: string;          // "datopotamab deruxtecan"
  therapeutic_area: string;  // THERAPEUTIC_AREAS キー
  indication: string;        // "トリプルネガティブ乳がん"
  phase: PipelinePhase;
  japan_status: string;      // "日本Phase3進行中" or "グローバルのみ"
  expected_approval: string | null;  // "2026" or null
  significance: 'high' | 'medium' | 'low';
  note: string;
}

/** 企業コンテキスト全体 */
export interface CompanyContext {
  // メタ情報
  company_id: string;
  last_updated: string;          // "2026-03"
  data_source: string;           // "IR資料 2025年度, ClinicalTrials.gov"

  // 業績概要
  financials: {
    global_revenue_usd_b: number | null;
    japan_revenue_jpy_b: number | null;
    trend: 'growing' | 'stable' | 'declining';
    trend_note: string;
  };

  // 主力製品（売上上位 5-8 製品）
  key_products: KeyProduct[];

  // 新薬パイプライン（注目案件 5-10 件）
  pipeline: PipelineItem[];

  // 日本市場での特徴
  japan_focus: {
    strengths: string[];
    growth_areas: string[];
    challenges: string[];
    headcount_trend: 'expanding' | 'stable' | 'restructuring';
    note: string;
  };

  // 企業文化・働き方（転職者向け）
  culture: {
    work_style: string;
    decision_speed: string;
    career_path: string;
    reputation: string;
  };
}

/** 求人ブリーフ（analysis_data 内に追加） */
export interface JobBrief {
  summary: string;               // 400-600文字の標準化ブリーフ
  context_signal: ContextSignal; // hot / growing / stable / caution
  context_reason: string;        // シグナルの根拠1文
  comparison_tags: string[];     // 横断比較用タグ
}
