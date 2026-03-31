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

- `DATABASE_URL`（必須）: Postgres 接続文字列
- `MISSION_CONTROL_PASSWORD`（必須）: ログイン用の単一パスワード
- `DATA_MODE`（任意）: `mock | csv | db`（現在は `mock` のみ実装）
- `PORT`（任意）: backend ポート（default: 4000）
- `FRONTEND_ORIGIN`（任意）: CORS を有効化したい場合に指定（例: `http://localhost:3000`）
- `GOOGLE_REDIRECT_URI`（本番必須）: SES backend の公開 URL に合わせる
- `DISCORD_WEBHOOK_URL`（任意）: Discord の Incoming Webhook URL（Mission Control から「シキ/ツムギ/…」の persona で投稿）
- `SALES_OWNER_ALIASES`（任意）: `営業A:eigyo-a@example.com,eigyo-a+alias@example.com;営業B:eigyo-b@example.com`
- `AGGREGATION_MAILBOXES`（任意）: 集約用 Gmail アドレスをカンマ区切りで指定。担当営業推定の候補から除外する

> 注意: `DISCORD_WEBHOOK_URL` は第三者に共有しないでください（貼られると誰でも投稿できる可能性があります）。

### SES 用: 担当営業の推定設定

営業マンごとのメールに届いた案件/人材を 1 つの Gmail に集約する運用向けに、backend は `To / Cc / Delivered-To / X-Original-To` を見て担当営業を推定します。

- 簡易運用なら `.env` の `SALES_OWNER_ALIASES` と `AGGREGATION_MAILBOXES` だけで動きます
- 安定運用するなら [backend/config/salesOwners.example.json](backend/config/salesOwners.example.json) をコピーして `backend/config/salesOwners.json` を作ってください

例:

```json
{
  "aggregationMailboxes": ["ses-hub@example.com"],
  "owners": [
    { "name": "営業A", "emails": ["eigyo-a@example.com", "eigyo-a+alias@example.com"] },
    { "name": "営業B", "emails": ["eigyo-b@example.com"] }
  ]
}
```

この設定があると、案件一覧・人材一覧・マッチ・重複候補で「誰宛て由来か」を安定して表示できます。

### 提出用デプロイ構成

- frontend は `Vercel`
- backend は `Railway`
- DB は `Railway Postgres` などの Postgres

backend は [backend/railway.json](backend/railway.json) を同梱しています。Railway では `backend/` をサービス root にし、少なくとも以下を設定してください。

- `DATABASE_URL`
- `FRONTEND_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `MISSION_CONTROL_PASSWORD`
- `OPENAI_API_KEY`

初回は backend 側で以下を実行してスキーマを入れます。

```bash
cd backend
npm run db:push
```

frontend は [frontend/.env.example](frontend/.env.example) をもとに `VITE_API_BASE_URL` を設定してください。Vercel では `https://your-ses-backend.up.railway.app` のような backend 公開 URL を入れます。

### Discord webhook（persona 投稿）

- フロントの Account 詳細画面に **persona picker** と **T#（T1..T4）ステータスのクイック投稿**を用意しています。
- persona は以下の key を送ります（backend 側の定義と一致）：
  - `moru`, `shiki`, `tsumugi`, `kensaku`, `hajime`, `suu`, `kumi`, `kotone`, `hiraku`

### データソース（次の一手）

- `DATA_MODE=db` を実装する際は、まず以下の **DB view** を作る想定です（命名は案）：
  - `mc_accounts`（tenant/account の基本情報・ステータス）
  - `mc_learners`（accountId, learnerId, lastActivityAt, submissions_30d など）
- `DATA_MODE=csv` は、上記 view と同じ形の CSV を読み込むアダプタに差し替えるだけで移行できるようにしています。

## SES システムの現在地

このフォルダには Mission Control 要素も混在していますが、SES 本体としては現時点で以下まで入っています。

- 受信一覧、案件、人材、マッチの導線
- `.eml` / 手入力 / Gmail からの取り込み
- 営業担当メールアドレスの推定と保持
- 案件/人材一覧での担当営業フィルタ
- 案件/人材の重複候補ビュー
- 重複候補からの手動統合
- 統合履歴の表示
- Match の Hard Filter 寄り除外理由
- Match の推薦理由 / 注意点 / 確認質問表示

まだ粗い箇所:

- 名寄せアルゴリズムは簡易候補提示レベル
- Match スコアは仕様寄りに改善中だが、辞書ベースの本実装ではない
- Inbox の抽出確認導線は軽量で、監査/修正フローはまだ弱い

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
| [backend/](backend/) | **Express + Prisma + TypeScript**。`npm run dev` で API 起動（ポート 4000）。提出用は Railway 想定。 |
| [frontend/](frontend/) | **Vite + React + TypeScript + Tailwind**。`npm run dev` で起動（ポート 3000）。`VITE_API_BASE_URL` で backend を切り替える。 |
| [MVPスコープ.md](MVPスコープ.md) | MVP で含める/含めない機能の一覧 |
| [本番スコープ.md](本番スコープ.md) | 本番で追加する機能・非機能 |

---

## 技術スタック（想定）

- **バックエンド**: Node.js + Express + Prisma + Postgres
- **フロント**: React + TypeScript（または Next.js）
- **取り込み**: Gmail API / IMAP、.eml パース
- **AI**: OpenAI 等（分類・抽出・理由生成）
- **ストレージ**: 添付は S3 相当 or Google Drive（[データ保持と権限](../docs/データ保持と権限.md) に従う）

既存の [.cursorrules](../.cursorrules) やプロジェクトルールに合わせて選定する。
