# Git で別 PC に共有する手順

## この PC でやること（リモートにプッシュ）

### 1. GitHub などでリポジトリを作成

- **GitHub**: https://github.com/new で「New repository」を作成
  - リポジトリ名は任意（例: `ses-match`）
  - **「Add a README file」などは付けない**（既にローカルにコードがあるため）
  - 作成後に表示されるリポジトリ URL をコピー（例: `https://github.com/あなたのユーザー名/ses-match.git`）

### 2. リモートを追加してプッシュ

プロジェクトのルート（`T &S`）で実行：

```bash
cd "/Users/mjup/T &S"

# リモート追加（URL は実際のリポジトリ URL に置き換え）
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git

# プッシュ（初回は -u で upstream を設定）
git push -u origin main
```

GitHub で **SSH** を使う場合の例：

```bash
git remote add origin git@github.com:あなたのユーザー名/リポジトリ名.git
git push -u origin main
```

---

## 別 PC でやること（クローンして使う）

### 1. リポジトリをクローン

```bash
git clone https://github.com/あなたのユーザー名/リポジトリ名.git
cd リポジトリ名
```

### 2. 環境構築（proposal-b-webapp を使う場合）

- ルートの `.env.example` を `.env` にコピーして必要なら編集
- `proposal-b-webapp/backend/.env.example` を `proposal-b-webapp/backend/.env` にコピー
- 依存関係のインストールと DB 準備：

```bash
cd proposal-b-webapp/backend && npm install && npx prisma migrate deploy
cd ../frontend && npm install
```

- 開発開始手順は `proposal-b-webapp/開発開始手順.md` を参照

---

## 今後、変更を同期するとき

- **この PC で変更を反映する場合**: `git add .` → `git commit -m "メッセージ"` → `git push`
- **別 PC で最新を取り込む場合**: `git pull`
