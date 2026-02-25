# 提案②：専用システム版（Web＋DB / 本番運用）

## Mission Control MVP（このリポジトリの現状）

テナント（アカウント）ごとの健康状態を俯瞰し、フォロー用の LINE 文面を生成する **Mission Control** の最小実装を同梱しています。

### 起動（開発）

- backend（http://localhost:4000）
  - `cd backend && npm run dev`
- frontend（http://localhost:3000）
  - `cd frontend && npm run dev`

### 環境変数（backend/.env）

backend は **`backend/.env`** を読み込みます（ローカル用。Git にコミットしない）。

```bash
cd backend
cp .env.example .env
```

backend 側に以下を設定してください。

- `MISSION_CONTROL_PASSWORD`（必須）: ログイン用の単一パスワード
- `DATA_MODE`（任意）: `mock | csv | db`（現在は `mock` のみ実装）
- `PORT`（任意）: backend ポート（default: 4000）
- `FRONTEND_ORIGIN`（任意）: CORS を有効化したい場合に指定（例: `http://localhost:3000`）
- `DISCORD_WEBHOOK_URL`（任意）: Discord の Incoming Webhook URL（Mission Control から「シキ/ツムギ/…」の persona で投稿）

> 注意: `DISCORD_WEBHOOK_URL` は第三者に共有しないでください（貼られると誰でも投稿できる可能性があります）。

### Discord webhook（persona 投稿）

- フロントの Account 詳細画面に **persona picker** と **T#（T1..T4）ステータスのクイック投稿**を用意しています。
- persona は以下の key を送ります（backend 側の定義と一致）：
  - `moru`, `shiki`, `tsumugi`, `kensaku`, `hajime`, `suu`, `kumi`, `kotone`, `hiraku`

### データソース（次の一手）

- `DATA_MODE=db` を実装する際は、まず以下の **DB view** を作る想定です（命名は案）：
  - `mc_accounts`（tenant/account の基本情報・ステータス）
  - `mc_learners`（accountId, learnerId, lastActivityAt, submissions_30d など）
- `DATA_MODE=csv` は、上記 view と同じ形の CSV を読み込むアダプタに差し替えるだけで移行できるようにしています。

---

メール/ファイルを取り込み、DB で正規化して「検索・名寄せ・マッチ・進捗」を一気通貫で管理する専用アプリ（ブラウザで利用）。

---

## 概要

- **ゴール**: 本番運用。毎日大量、権限・監査・名寄せ・データ資産化に対応する。
- **期間**: MVP 4〜8週間 / 本番 2〜4ヶ月
- **費用相場**: 初期 150〜1500万円 / 月額 4〜50万円（本文中心〜添付多め）

---

## 主な機能（スプシ版 ＋ 強化）

| 機能 | 内容 |
|------|------|
| **取り込み** | Gmail API / IMAP 等の自動化、**原本保全**（添付/URL も保存） |
| **DB・検索** | 正規化 DB：高速検索（AND/NOT/条件プリセット） |
| **名寄せ** | 同一人物/同一案件の統合 ＋ 商流・条件違い（Offer）管理 |
| **マッチ** | 除外理由 ＋ スコア内訳 ＋ **根拠表示** |
| **進捗** | 提案〜面談〜成約のステータス、**重複提案防止ログ** |
| **運用** | 権限管理、監査ログ、バックアップ、運用ダッシュボード |

---

## 設計の所在（共通成果物をそのまま利用）

このリポジトリの以下が **提案② の設計・スキーマ** としてそのまま使える。

| 種類 | パス | 用途 |
|------|------|------|
| DB ER・Prisma | [schema/README.md](../schema/README.md), [schema/prisma/schema.prisma](../schema/prisma/schema.prisma) | データモデル・マイグレーション |
| 抽出スキーマ | [schemas/project-extract.json](../schemas/project-extract.json), [schemas/talent-extract.json](../schemas/talent-extract.json) | 案件/人材の固定JSON |
| マッチ・正規化 | [specs/マッチング仕様.md](../specs/マッチング仕様.md), [specs/正規化辞書仕様.md](../specs/正規化辞書仕様.md) | ルール・辞書 |
| 取り込み・名寄せ・権限・評価 | [docs/取り込み仕様.md](../docs/取り込み仕様.md), [docs/名寄せ_初期アルゴリズム.md](../docs/名寄せ_初期アルゴリズム.md), [docs/データ保持と権限.md](../docs/データ保持と権限.md), [docs/評価ループ.md](../docs/評価ループ.md) | 実装で詰まりやすい補強 |
| 画面イメージ | [docs/02_画面・シート設計.md](../docs/02_画面・シート設計.md)（Webアプリ化時） | 画面構成 |

---

## 開発フェーズ

### MVP（4〜8週間）

- 取り込み（手動 .eml または Gmail API のどちらか）
- 分類・抽出・正規化・台帳（TALENTS / PROJECTS 相当をDBで）
- 検索（AND/NOT、プリセット）
- 簡易マッチ（Hard Filter → スコア → 理由/質問/テンプレ）
- 名寄せは「候補提示 → 人が確定」まで
- 最低限の権限（閲覧/編集の区別）

### 本番（2〜4ヶ月）

- 取り込みの安定化（IMAP/Gmail API、原本保全・添付保管）
- 名寄せの強化（添付ハッシュ・同一判定の自動候補）
- 進捗・パイプライン・重複提案防止ログ
- 権限の細分化・監査ログ・バックアップ
- 運用ダッシュボード・評価ループ（採用/見送り→重み調整）

---

## 提案①からの移行

- 抽出スキーマ・マッチ仕様・辞書の考え方は **共通** なので、①で確定した「列＝項目」をそのまま②の DB カラム・API にマッピングできる。
- ①のスプシデータは CSV エクスポート → ②のインポートバッチで移行する想定。

---

## フォルダ内の成果物

| ファイル | 内容 |
|----------|------|
| [開発開始手順.md](開発開始手順.md) | **開発スタート用**：backend / frontend の起動手順 |
| [backend/](backend/) | **Express + Prisma + TypeScript**。`npm run dev` で API 起動（ポート 4000）。 |
| [frontend/](frontend/) | **Vite + React + TypeScript + Tailwind**。`npm run dev` で起動（ポート 3000）。API は /api で backend にプロキシ。 |
| [MVPスコープ.md](MVPスコープ.md) | MVP で含める/含めない機能の一覧 |
| [本番スコープ.md](本番スコープ.md) | 本番で追加する機能・非機能 |

---

## 技術スタック（想定）

- **バックエンド**: Node.js + Express（または Next.js API）+ Prisma + SQLite → 本番で Postgres 可
- **フロント**: React + TypeScript（または Next.js）
- **取り込み**: Gmail API / IMAP、.eml パース
- **AI**: OpenAI 等（分類・抽出・理由生成）
- **ストレージ**: 添付は S3 相当 or Google Drive（[データ保持と権限](../docs/データ保持と権限.md) に従う）

既存の [.cursorrules](../.cursorrules) やプロジェクトルールに合わせて選定する。
