# 提案①：スプレッドシート版（MVP）

Gmail 等から取り込んだ案件・人材情報を AI で項目抽出し、スプレッドシートで整理。スプシ上で絞り込み・簡易マッチ・テンプレ生成まで行う。

---

## 概要

- **ゴール**: まず回して効果検証。抽出項目・辞書・条件を現場で確定する。
- **期間**: 1〜3週間
- **費用相場**: 初期 30〜300万円 / 月額 1〜12万円（AI 利用料。添付多めで上振れ）

---

## 主な機能

| 機能 | 実装方針 |
|------|----------|
| **Gmail → スプシ取り込み** | Apps Script（トリガー or 手動実行）。受信メールをシート「RAW_EMAILS」に追記。 |
| **案件/人材の分類＋項目抽出** | 本文を AI（OpenAI 等）に送り、固定スキーマで抽出。結果を TALENTS / PROJECTS シートに追記。 |
| **フィルタ・プリセット** | スプシのフィルタビュー、または条件付き書式＋並び替え。 |
| **簡易マッチ** | 案件×人材をルール or 軽い AI でスコア化。MATCHES シートに理由・確認質問・提案テンプレを出力。 |

---

## シート構成（共通設計に合わせる）

ルートの [docs/02_画面・シート設計.md](../docs/02_画面・シート設計.md) を参照。スプシ版では次のタブを用意する。

| タブ | 用途 |
|------|------|
| RAW_EMAILS | 受信一覧（Message-ID, 日時, From, Subject, 分類, 処理状況, 本文要約 or リンク） |
| TALENTS | 人材台帳（抽出項目＝[schemas/talent-extract.json](../schemas/talent-extract.json) の主要項目を列に） |
| PROJECTS | 案件台帳（抽出項目＝[schemas/project-extract.json](../schemas/project-extract.json) の主要項目を列に） |
| MATCHES | おすすめ一覧（スコア, 理由, 注意点, 確認質問, テンプレ文） |
| SKILL_DICT | スキル辞書（スキルID, 正式名, 別名） |
| CONFIG | 閾値・重み・許容日数（マッチ計算用） |
| LOGS | 変更履歴（任意） |

---

## 開発で使う共通成果物

- **抽出スキーマ**: [schemas/talent-extract.json](../schemas/talent-extract.json), [schemas/project-extract.json](../schemas/project-extract.json)  
  → スプシの列名・AI プロンプトはこれに合わせる。
- **抽出プロンプト**: [prompts/extract_talent.md](../prompts/extract_talent.md), [prompts/extract_job.md](../prompts/extract_job.md)
- **マッチ仕様**: [specs/マッチング仕様.md](../specs/マッチング仕様.md)（Hard Filter・スコア・70点・理由生成）

---

## フォルダ内の成果物

| ファイル | 内容 |
|----------|------|
| [開発開始手順.md](開発開始手順.md) | **開発スタート用**：スプシ作成 → Apps Script 貼り付け → 実行・トリガー |
| [scripts/](scripts/) | **Apps Script 用コード**（Config.js, GmailToSheet.js, ClassifyAndExtract.js）→ そのまま .gs として貼って使う |
| [Apps_Script設計.md](Apps_Script設計.md) | Gmail 取り込み・トリガー・シート書き込みの設計 |
| [シート定義例.md](シート定義例.md) | 各タブの列名・データ型（スキーマ対応） |

---

## 限界（①のまま運用する場合）

- データ量増でスプシが重くなる
- 権限・監査が弱い（シートの共有範囲のみ）
- 名寄せの高度化が難しい

→ 効果が出たら **提案②（専用システム版）** へ移行することを推奨。[docs/提案比較と開発方針.md](../docs/提案比較と開発方針.md) 参照。
