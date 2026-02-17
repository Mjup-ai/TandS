# 提案①：Apps Script 設計（Gmail → スプシ取り込み）

スプレッドシート版で、Gmail からメールを取り込み、スプシに反映するための Apps Script 設計メモ。

---

## 前提

- 集約用 Gmail アカウント（またはラベル）を1つ決める。
- 対象メールは「未読」または「特定ラベル」で取得する。
- 取り込み結果は **RAW_EMAILS** シートに追記する。

---

## 処理フロー

1. **メール取得**  
   `GmailApp.getInboxThreads()` または `GmailApp.search('label:xxx is:unread')` でスレッド取得。  
   各メールで `getMessages()` から本文・件名・From・日付を取得。
2. **重複チェック**  
   Message-ID（または 件名+日付+From）が RAW_EMAILS に既にあればスキップ。
3. **シート追記**  
   RAW_EMAILS の次の空行に：`messageId`, `receivedAt`, `from`, `to`, `subject`, `bodyText`（長い場合は要約 or 別シート参照）, `classification`（未設定なら空）, `processing_status`（pending）。
4. **分類・抽出**  
   別トリガー or 手動で「pending の行」を AI に送り、分類＋項目抽出。結果を TALENTS または PROJECTS に追記し、RAW_EMAILS の `processing_status` を `extracted` に更新。

---

## シートとの対応

| シート | 書き込み元 | 内容 |
|--------|------------|------|
| RAW_EMAILS | メール取得スクリプト | 1メール = 1行。必須列: messageId, receivedAt, from, subject, bodyText, classification, processing_status |
| TALENTS | 抽出スクリプト（人材と判定された場合） | 1行 = 1人材。列は talent-extract の主要項目 |
| PROJECTS | 抽出スクリプト（案件と判定された場合） | 1行 = 1案件。列は project-extract の主要項目 |

---

## トリガー

- **取り込み**: 分単位の時間駆動トリガー（例: 5分ごと）で「未読メールを取得 → RAW_EMAILS に追記」。
- **抽出**: 時間駆動（例: 10分ごと）で「processing_status = pending の行」を上限件数だけ AI に送り、TALENTS/PROJECTS に追記。  
  または手動実行（「未処理メールを抽出」ボタン）。

---

## 制限・注意

- Apps Script の実行時間制限（6分/回）に注意。件数が多い場合は「未処理の先頭 N 件だけ」にする。
- 本文が長い場合は `bodyText` に全文を入れず、先頭 N 文字＋「全文は Gmail で確認」とする等でシート肥大化を防ぐ。
- AI 呼び出しは **外部 API（OpenAI 等）** を使う場合、UrlFetchApp で実装。API キーは Script のプロパティに保存し、コードに直書きしない。

---

## 原本保全（スプシ版での範囲）

- 本文全文は Gmail に残す前提。スプシには要約 or リンク（Gmail のスレッドURL）を保存する運用でも可。
- 添付は Gmail に残し、スプシには「添付あり」フラグ＋ファイル名のみ記録する等、軽くする。

本番の原本保全（添付実体・長期保存）は **提案②** で対応する。
