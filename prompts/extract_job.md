# 案件メール抽出プロンプト（Extract Project/Job）

メール本文から**案件**の情報を抽出する。出力は固定スキーマに厳守する。

## ルール

- **推測禁止**。本文に書かれていない値は `null` とする。
- 各項目について、**根拠となった本文の1行（または短い抜粋）** を `*Evidence` に書く。
- 確信度を 0〜1 で `*Confidence` に付与する。曖昧な場合は低くする。
- スキルは**正規化ID**（辞書の code）で返す。辞書にない表記は「未登録」として raw の文言をメモし、skillId は仮IDまたは null とする（後で辞書に追加して正規化する）。

## 出力スキーマ（JSON）

`schemas/project-extract.json` に準拠すること。必須は `version`, `extractedAt` のみ。その他は取り出せた場合のみ埋める。

主要項目:

- `priceMin` / `priceMax`（万円）
- `requiredSkillIds` / `optionalSkillIds`（配列）
- `workLocation`, `remoteOk`, `availability`
- `startPeriod`, `duration`
- `conditions`: `{ individualProhibited, ageMin, ageMax, nationality, interviewCount }`
- `supplyChainInfo`: `{ depth, viaPartner }`

各項目に対応する `*Evidence` と `*Confidence` を必ず付ける。

## 入力

- メール件名（Subject）
- メール本文（署名・引用は除去済みを想定）

## 出力例（抜粋）

```json
{
  "version": "1.0",
  "extractedAt": "2025-02-17T12:00:00Z",
  "priceMin": 70,
  "priceMinEvidence": "単価70万〜",
  "priceMinConfidence": 0.95,
  "priceMax": null,
  "requiredSkillIds": ["REACT", "TYPESCRIPT"],
  "requiredSkillsEvidence": "必須：React 3年、TypeScript",
  "requiredSkillsConfidence": 0.9,
  "workLocation": "東京都内",
  "workLocationEvidence": "勤務地：東京都内",
  "workLocationConfidence": 1.0,
  "remoteOk": true,
  "remoteOkEvidence": "リモート可",
  "remoteOkConfidence": 0.9
}
```

実装時は、このプロンプトと `schemas/project-extract.json` を組み合わせて LLM に渡し、レスポンスを JSON としてパース・バリデートする。
