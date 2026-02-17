# DB ER設計（コアラ超え版）

名寄せと商流を前提にしたデータモデル。同一人物・同一案件を「オファー」で分離し、最良条件表示と二重提案防止を可能にする。

## エンティティ概要

### 原本系（監査・再解析のため必須）

- **raw_emails** … メール原文・メタ（Message-ID, 受信日時, From, Subject 等）
- **raw_attachments** … 添付（スキルシート等）
- **raw_links** … 本文内URL（スキルシート参照等）
- **ingest_events** … 処理ログ（いつ何を解析したか）

### 台帳の本体（正規化後）

- **projects** … 案件の正規化レコード（案件そのもの）
- **talents** … 人材の正規化レコード（人物そのもの）
- **companies** … 発注企業
- **partners** … BP（パートナー/商流の中継）
- **skills** … スキル辞書（ID）
- **skill_aliases** … 同義語（React.js → React 等）

### オファー（商流・条件の違いを保持）

- **project_offers** … 同一案件が複数ルートで来た場合の条件違い（単価・支払サイト・商流深度・面談回数等）
- **talent_offers** … 同一人物が複数BPから来た場合の条件違い（希望単価・可動・商流・本人確度等）

### マッチ・進捗

- **matches** … project_offer × talent_offer の候補、スコア、内訳、理由、除外理由
- **pipeline** … 提案→面談→成約のステータス
- **activities** … 誰が見た/確定した/提案した（事故防止ログ）

## ER 関係（簡略）

```
raw_emails 1---* raw_attachments
raw_emails 1---* raw_links
raw_emails 1---* ingest_events

raw_emails ---> project_offers (source)
raw_emails ---> talent_offers (source)

projects 1---* project_offers
talents  1---* talent_offers
companies 1---* projects
partners 1---* project_offers
partners 1---* talent_offers

skills 1---* skill_aliases
(projects/talents と skills は多対多の中間テーブルで保持)

matches: project_offer_id, talent_offer_id, score, breakdown, reasons, ...
pipeline: match_id or (project_offer_id, talent_offer_id), status, ...
activities: user, action, target_type, target_id, at
```

## 名寄せの考え方

- **talents**: 同一人物と判定されたレコードは 1 つの `talent` に束ねる（`talent_offers` が複数）
- **projects**: 同一案件と判定されたレコードは 1 つの `project` に束ねる（`project_offers` が複数）
- 検索・マッチは「オファー」単位で行い、一覧では同一 talent/project のうち**最良条件のオファー**を優先表示する。

詳細なカラム定義は `schema/prisma/schema.prisma` を参照。
