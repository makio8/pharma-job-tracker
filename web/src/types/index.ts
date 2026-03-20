export interface Company {
  id: string;
  name_ja: string;
  name_en: string;
  category: 'foreign' | 'domestic';
  careers_url: string;
  scraper: string;
  active: number;
  active_jobs: number;
}

export interface Job {
  id: number;
  company_id: string;
  external_id: string | null;
  title: string;
  department: string | null;
  location: string | null;
  job_category: string | null;
  url: string | null;
  description: string | null;
  requirements: string | null;
  therapeutic_area: string | null;
  analysis_data: Record<string, unknown> | null;
  first_seen: string; // YYYY-MM-DD
  last_seen: string;
  status: 'active' | 'closed';
}

export interface Snapshot {
  id: number;
  scan_date: string;
  company_id: string;
  total_jobs: number;
  new_jobs: number;
  closed_jobs: number;
}

export interface Meta {
  last_updated: string;
  total_active_jobs: number;
  new_today: number;
  companies_count: number;
}

// 求人カテゴリの日本語ラベル
export const JOB_CATEGORY_LABELS: Record<string, string> = {
  mr: 'MR',
  rd: '研究開発',
  clinical: '臨床開発',
  regulatory: '薬事',
  medical: 'メディカル',
  marketing: 'マーケティング',
  sales: '営業・コマーシャル',
  strategy: '戦略・企画',
  pv: '安全性情報',
  manufacturing: '製造・品質',
  digital: 'DX・デジタル',
  corporate: 'コーポレート',
  other: 'その他',
};

export const THERAPEUTIC_AREA_LABELS: Record<string, string> = {
  oncology: 'オンコロジー',
  immunology: '免疫・炎症',
  cns: 'CNS・精神神経',
  cardiovascular: '循環器',
  rare: '希少疾患',
  infectious: '感染症',
  ophthalmology: '眼科',
  hematology: '血液',
  respiratory: '呼吸器',
  gastro: '消化器',
  dermatology: '皮膚',
  general: 'その他',
};
