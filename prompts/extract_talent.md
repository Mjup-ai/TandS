# 人材メール抽出プロンプト（Extract Talent）

メール本文から**人材**の情報を抽出する。出力は固定スキーマに厳守する。

## ルール

- **推測禁止**。本文に書かれていない値は `null` とする。
- 各項目について、**根拠となった本文の1行（または短い抜粋）** を `*Evidence` に書く。
- 確信度を 0〜1 で `*Confidence` に付与する。曖昧な場合は低くする。
- スキルは**正規化ID**（辞書の code）で返す。辞書にない表記は「未登録」として raw の文言をメモし、skillId は仮IDまたは null とする（後で辞書に追加して正規化する）。
- スキルシートがURLや添付で言及されていれば、`skillSheetUrl` または `skillSheetAttachmentId` に反映する。

## 出力スキーマ（JSON）

`schemas/talent-extract.json` に準拠すること。必須は `version`, `extractedAt` のみ。その他は取り出せた場合のみ埋める。

主要項目:

- `hopePriceMin` / `hopePriceMax`（万円）
- `age`, `employmentTypeId`
- `nearestStationId`, `workLocationPreference`
- `skills`: 配列。各要素は `{ skillId, years, lastUsed, evidence, confidence }`
- `availability`（週5/週3等）, `startAvailableDate`
- `skillSheetUrl`, `skillSheetAttachmentId`

各項目に対応する `*Evidence` と `*Confidence` を必ず付ける。`skills` 配列の各要素にも `evidence` と `confidence` を付ける。

## 入力

- メール件名（Subject）
- メール本文（署名・引用は除去済みを想定）
- 添付ファイル名・本文内URL（スキルシート参照用）

## 出力例（抜粋）

```json
{
  "version": "1.0",
  "extractedAt": "2025-02-17T12:00:00Z",
  "hopePriceMin": 75,
  "hopePriceMinEvidence": "希望単価75万〜",
  "hopePriceMinConfidence": 0.9,
  "age": 35,
  "ageEvidence": "35歳",
  "ageConfidence": 1.0,
  "employmentTypeId": "CONTRACT",
  "employmentTypeEvidence": "契約社員",
  "employmentTypeConfidence": 0.95,
  "skills": [
    { "skillId": "REACT", "years": 3, "lastUsed": "2024年", "evidence": "React 3年 直近2024年", "confidence": 0.9 }
  ],
  "availability": "週5",
  "availabilityEvidence": "週5稼働可",
  "availabilityConfidence": 0.95,
  "startAvailableDate": "2025-03-01",
  "startAvailableEvidence": "3月から入場可能",
  "startAvailableConfidence": 0.85,
  "skillSheetUrl": "https://..."
}
```

実装時は、このプロンプトと `schemas/talent-extract.json` を組み合わせて LLM に渡し、レスポンスを JSON としてパース・バリデートする。
