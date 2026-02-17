# Gmail API の取り方（簡易まとめ）

メールを「読むだけ」なら次の手順で足りる。

---

## 1. Google Cloud でやること

1. **[Google Cloud コンソール](https://console.cloud.google.com/)**
   - プロジェクトを新規作成（または既存を選択）。

2. **API を有効化**
   - 「APIとサービス」→「ライブラリ」→「Gmail API」を検索 → **有効にする**。

3. **OAuth 同意画面**
   - 「APIとサービス」→「OAuth 同意画面」。
   - ユーザータイプ: **外部**（社内だけなら「内部」も可）。
   - スコープで **`.../auth/gmail.readonly`**（メール読み取り）を追加。
   - テスト運用なら「テストユーザー」に、連携したい Gmail アドレス（専用アカウント2つ）を追加。

4. **認証情報**
   - 「APIとサービス」→「認証情報」→「認証情報を作成」→ **OAuth 2.0 クライアント ID**。
   - アプリケーションの種類: **デスクトップアプリ**（または「ウェブアプリ」でリダイレクトURLを設定）。
   - 作成すると **クライアント ID** と **クライアント シークレット** が発行される → **JSON をダウンロード**（`credentials.json` として保存）。

---

## 2. コード側でやること（イメージ）

- **credentials.json** をプロジェクトの安全な場所に置く（git に上げない）。
- OAuth の「認可コード」フローで、**各専用アカウント**で一度だけブラウザログイン → **リフレッシュトークン**を取得・保存（2アカウントなら2つ）。
- メール取得時: リフレッシュトークンでアクセストークンを取り、  
  `GET https://gmail.googleapis.com/gmail/v1/users/me/messages`（未読など）→ 必要なメールの `messages.get` で本文取得。

---

## 3. スコープ（読むだけ）

```
https://www.googleapis.com/auth/gmail.readonly
```

これで「メール一覧・本文・添付の取得」ができる。送信は不要ならこれだけでよい。

---

## 4. 2アカウントの場合

- 同じ **credentials.json**（クライアントID・シークレット）でよい。
- **リフレッシュトークンだけアカウントごとに別**。  
  アカウントA用・アカウントB用の2つのリフレッシュトークンを保存し、取得時に使い分ける。

---

## 5. 参考リンク

- [Gmail API 概要](https://developers.google.com/gmail/api/guides)
- [OAuth 2.0 の認可（認可コード）](https://developers.google.com/identity/protocols/oauth2)

**料金**: 通常の読み取り利用なら **無料** 枠内。

---

## Gmail じゃない場合（Outlook・社内サーバーなど）

メールが **Gmail / Google Workspace 以外** のときの取り方。

| 環境 | 取り方 | メモ |
|------|--------|------|
| **Outlook.com / Microsoft 365（個人・法人）** | **Microsoft Graph API**（REST） | OAuth 2.0。スコープ `Mail.Read` でメール読み取り。 [Graph エクスプローラー](https://developer.microsoft.com/ja-jp/graph/graph-explorer) で動作確認可。 |
| **Outlook やその他で IMAP が有効** | **IMAP**（Node なら `imap` や `node-imap` 等） | ホスト・ポート・アカウント・パスワード（またはアプリパスワード）で接続。フォルダを指定してメール一覧・本文取得。 |
| **社内メールサーバー（Exchange 以外）** | **IMAP** が使えれば同上。 | 管理者に IMAP 有効化・ポート・認証方法を確認。 |
| **Yahoo メール** | **IMAP**（Yahoo はアプリパスワード発行が必要） | 設定で IMAP を有効にし、アプリ用パスワードを発行して IMAP で接続。 |

**共通**: 「どのプロトコルが使えるか」（IMAP / Graph）を確認 → そのプロトコル用のライブラリで「未読 or 指定フォルダのメール一覧 → 本文取得」を実装する。取得した中身は、このシステムでは同じく **RawEmail** に保存すれば、あとの分類・マッチは同じ。
