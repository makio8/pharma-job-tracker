# 未分析求人の一括ブリーフ生成

未分析の求人を取得し、企業別に並列エージェントで分析・ブリーフを生成してDBに保存する。

## 手順

### Step 1: 未分析求人を取得して企業別に分割

```bash
cd /Users/ai/projects/personal/pharma-job-tracker
mkdir -p /tmp/pharma-analyze/batches /tmp/pharma-analyze/results
```

`npx tsx scripts/list-unanalyzed.ts --limit 500` を実行して未分析求人の総数と企業別件数を確認する。

0件なら「全件分析済みです」と報告して終了。

企業別にバッチファイルを生成:
```bash
for company in $(npx tsx scripts/list-unanalyzed.ts --limit 500 2>/dev/null | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8')); [...new Set(d.map(j=>j.company_id))].forEach(c=>console.log(c))"); do
  npx tsx scripts/list-unanalyzed.ts --limit 100 --company $company 2>/dev/null > /tmp/pharma-analyze/batches/${company}.json
done
```

### Step 2: 並列エージェントで分析

企業をグループ化（1エージェントあたり2-3社、合計30件以下を目安）し、バックグラウンドエージェントを並列投入する。

各エージェントへのプロンプト:

```
あなたは製薬業界の求人分析エキスパートです。企業コンテキストを踏まえて求人ブリーフを生成してください。

## タスク
1. `/tmp/pharma-analyze/batches/{company}.json` を読んで全求人データを取得
2. `/Users/ai/projects/personal/pharma-job-tracker/data/company-context/{company}.json` を読んで企業コンテキストを取得
3. 各求人について分析結果を生成
4. 結果を `/tmp/pharma-analyze/results/{company}.json` に書き出す

## 出力フォーマット（JSON配列）
[
  {
    "id": 求人ID,
    "analysis": {
      "experience_years_min": 数値またはnull,
      "english_level": "none|reading|conversational|business|fluent",
      "job_level": "junior|mid|senior|lead|manager|director",
      "management_role": boolean,
      "global_scope": "local_only|local_with_global|global_lead",
      "work_style": "office|hybrid|remote|field",
      "key_skills": ["スキル1", "スキル2"],
      "required_qualifications": ["資格1"],
      "education_level": "any|bachelor|master|phd" またはnull,
      "career_change_friendly": boolean,
      "clinical_phase": "phase1|phase2|phase3|filed|marketed" またはnull,
      "hiring_context": "growth|replacement|new_function|unknown",
      "team_size_hint": "small|medium|large" またはnull,
      "territory": "エリア名" またはnull（MR/フィールド職のみ）,
      "brief": {
        "summary": "400-600文字の求人ブリーフ（下記テンプレート）",
        "context_signal": "hot|growing|stable|caution",
        "context_reason": "シグナルの根拠を1文で",
        "comparison_tags": ["タグ1", "タグ2", "タグ3"]
      }
    }
  }
]

## brief.summary テンプレート
【ポジション概要】
{会社名}の{部門}が募集する{職種}。{具体的な業務内容を2-3文で}

【この求人の背景】
{企業コンテキストを踏まえた解説。なぜ今この求人があるのか}

【転職者への示唆】
{この求人の魅力と注意点を1-2文で}

## context_signal 判定ルール
- hot: パイプラインにphase3/filedの高注目品あり＋その領域の求人
- growing: japan_focus.growth_areasに合致、またはheadcount=expanding
- stable: 上記に該当しない通常ポジション
- caution: key_productsにloe_risk/decliningあり＋その領域の求人

## 重要
- descriptionの内容を丁寧に読んで分析すること
- 企業コンテキストを必ず参照してcontext_signalを判定
- 全件処理すること（スキップ禁止）
- 結果はValid JSONで書き出すこと
```

### Step 3: 結果をDB保存

全エージェント完了後、結果ファイルをDB保存:
```bash
cd /Users/ai/projects/personal/pharma-job-tracker
for f in /tmp/pharma-analyze/results/*.json; do
  company=$(basename $f .json)
  npx tsx scripts/save-analysis.ts "$f"
done
```

### Step 4: エクスポート

```bash
npx tsx scripts/export-json.ts
```

### Step 5: 結果報告

- 処理件数（企業別）
- context_signal の分布（hot/growing/stable/caution）
- 注目ポイント（hotな求人の概要）
