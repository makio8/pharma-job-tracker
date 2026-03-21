# 共通日本求人フィルタ層 設計スペック

## 課題

バッチ分析で3つのデータ品質問題が発覚:

1. **AbbVie**: 15件中13件が米国求人（`q=japan`のURL検索のみで取得後のlocation検証なし）
2. **サノフィ**: 中国求人が混入（URL指定のみで二次フィルタなし）
3. **小野・住友**: 個別求人ではなく採用ポータルページをスクレイプ

## 解決方針

**A案: 共通フィルタ層** を採用。全スクレイパーの後段に日本求人チェッカーを1つ置く。

## アーキテクチャ

```
各スクレイパー → ScraperResult（生データ）
                    ↓
              japanJobFilter（共通フィルタ層）← NEW
                    ↓
              フィルタ済みScraperResult
                    ↓
              diff/detector → DB保存
```

## 新規ファイル

### `src/utils/japan-filter.ts`

```typescript
const JAPAN_LOCATION_KEYWORDS = [
  // 英語（都市・県）
  'japan', 'tokyo', 'osaka', 'nagoya', 'kobe', 'kyoto',
  'yokohama', 'fukuoka', 'sapporo', 'hiroshima', 'sendai',
  'chiba', 'kanagawa', 'hyogo', 'aichi', 'saitama', 'ibaraki',
  'shizuoka', 'toyama', 'yamaguchi',
  // 工場・拠点名
  'nishikobe', 'hikari', 'fuji', 'toranomon', 'nihonbashi',
  'sasayama', 'takatsuki', 'tsukuba', 'shonan',
  // 日本語
  '日本', '東京', '大阪', '名古屋', '神戸', '京都',
  '横浜', '福岡', '札幌', '広島', '仙台',
  '千葉', '神奈川', '兵庫', '愛知', '埼玉', '茨城',
  '静岡', '富山', '山口', '高槻', 'つくば', '湘南',
];

export function filterJapanJobs(jobs: ScrapedJob[], companyId: string): {
  filtered: ScrapedJob[];
  removed: ScrapedJob[];
} {
  const filtered: ScrapedJob[] = [];
  const removed: ScrapedJob[] = [];

  for (const job of jobs) {
    if (isJapanJob(job)) {
      filtered.push(job);
    } else {
      removed.push(job);
    }
  }

  if (removed.length > 0) {
    logger.warn(`[${companyId}] 非日本求人を除外: ${removed.length}件`);
    for (const r of removed) {
      logger.debug(`  除外: "${r.title}" (location: ${r.location})`);
    }
  }

  return { filtered, removed };
}

function isJapanJob(job: ScrapedJob): boolean {
  const location = (job.location || '').toLowerCase();
  // locationが空 → 通過（国内企業の自社サイトはlocation省略が多い）
  if (!location) return true;
  return JAPAN_LOCATION_KEYWORDS.some(kw => location.toLowerCase().includes(kw));
}
```

### 判定ルール

| locationの状態 | 判定 | 理由 |
|---|---|---|
| 空 / null | ✅ 通過 | 国内企業（小野・住友等）はlocation省略が多い |
| 日本キーワード含む | ✅ 通過 | 日本求人 |
| 日本キーワードなし | ❌ 除外 | 米国・中国等の海外求人 |

## 変更ファイル

### `src/index.ts`

各スクレイパー実行直後、`detector.detectDiff()` の前に `filterJapanJobs()` を挿入。

## 小野・住友の個別対応

共通フィルタでは解決しない問題（ポータルページのスクレイプ）:

- 現状のスクレイパーを確認し、個別求人が取得できるよう修正
- 修正不可能な場合は `schema.ts` で `active: 0` に設定して除外
- 分析で判明した既存の非求人データはDBから手動削除

## 既存データのクリーンアップ

`scripts/cleanup-non-japan-jobs.ts` を作成:
- DBの全アクティブ求人のlocationを検査
- 非日本求人を `status = 'removed'` に更新
- 小野・住友のポータルページデータも同様に処理

## テスト

- japan-filter.ts の単体テスト（日本求人通過・海外求人除外・location空通過）
- 既存スクレイパーの動作に影響がないことを確認（フィルタは追加のみ）
