# SES マッチングシステム設計（コアラ超え最強版）

メールをDB化して「探せる」を完成させ、名寄せ・商流最適化・マッチ理由・確認質問まで出して「動ける」にするシステムの設計成果物です。開発にそのまま渡せる粒度で整理しています。

## 勝ち筋（KPI）

- **初回候補提示までの時間：現状の1/10**
- 「探す時間」削減 → 提案数増加
- 「なぜこの候補？」が説明できる（スコア内訳・根拠行）

運用方針：連絡（メール/電話）は**人が行う**。システムは候補・理由・注意点・確認質問・テンプレ文を出して動けるようにする。

---

## 2パターンで開発

| 提案 | 概要 | 期間・費用相場 | 開発用フォルダ |
|------|------|----------------|----------------|
| **① スプレッドシート版** | Gmail→スプシ取り込み、AI抽出、絞り込み・簡易マッチ・テンプレ | 1〜3週間 / 初期30〜300万 / 月額1〜12万 | [proposal-a-spreadsheet/](proposal-a-spreadsheet/) |
| **② 専用システム版** | Web＋DB、取り込み〜名寄せ〜マッチ〜進捗、権限・監査 | MVP 4〜8週 / 本番2〜4ヶ月 / 初期150〜1500万 / 月額4〜50万 | [proposal-b-webapp/](proposal-b-webapp/) |

**推奨ストーリー**：まず①で効果検証（抽出項目・辞書・条件を確定）→ 効果が見えたら②へ移行（名寄せ・権限・監査で本番化）。失敗確率が一番低い。

→ 詳細は [docs/提案比較と開発方針.md](docs/提案比較と開発方針.md)。**運用でかかりそうなお金**は [docs/運用コストの目安.md](docs/運用コストの目安.md)。

**開発スタート**：①は [proposal-a-spreadsheet/開発開始手順.md](proposal-a-spreadsheet/開発開始手順.md)、②は [proposal-b-webapp/開発開始手順.md](proposal-b-webapp/開発開始手順.md) から。

---

## 成果物一覧（開発渡し用）

| # | 成果物 | パス | 説明 |
|---|--------|------|------|
| 1 | 要件・KPI・運用 | [docs/requirements.md](docs/requirements.md) | 判断基準の集約 |
| 2 | 業務フロー | [docs/01_業務フロー.md](docs/01_業務フロー.md) | 現状→新運用 |
| 3 | 画面/シート設計 | [docs/02_画面・シート設計.md](docs/02_画面・シート設計.md) | 各タブ・画面の項目 |
| 4 | 運用ルール | [docs/03_運用ルール.md](docs/03_運用ルール.md) | 承認・ログ・権限・コスト上限 |
| 5 | ロードマップ | [docs/04_ロードマップ.md](docs/04_ロードマップ.md) | MVP1 → MVP2 → 最強版 |
| 6 | **取り込み仕様** | [docs/取り込み仕様.md](docs/取り込み仕様.md) | 転送形式・原本保全の定義 |
| 7 | **名寄せ（初期）** | [docs/名寄せ_初期アルゴリズム.md](docs/名寄せ_初期アルゴリズム.md) | 同一判定キー・候補→人が確定 |
| 8 | **スキル辞書運用** | [docs/スキル辞書運用.md](docs/スキル辞書運用.md) | 誰が更新・SKILL_DICT・更新ログ |
| 9 | **データ保持・権限** | [docs/データ保持と権限.md](docs/データ保持と権限.md) | 役割・保存期間・添付保管 |
| 10 | **評価ループ** | [docs/評価ループ.md](docs/評価ループ.md) | 採用/見送り→重み調整 |
| 11 | DB ER設計 | [schema/README.md](schema/README.md), [schema/prisma/schema.prisma](schema/prisma/schema.prisma) | entities + offers + matches + pipeline |
| 12 | 固定JSONスキーマ | [schemas/project-extract.json](schemas/project-extract.json)（案件）, [schemas/talent-extract.json](schemas/talent-extract.json)（人材） | 抽出の心臓 |
| 13 | 正規化辞書仕様 | [specs/正規化辞書仕様.md](specs/正規化辞書仕様.md) | skills / 駅 / 雇用形態 / 単価 |
| 14 | マッチング仕様 | [specs/マッチング仕様.md](specs/マッチング仕様.md), [docs/matching.md](docs/matching.md) | Hard Filter / Score / 閾値70 |
| 15 | 抽出プロンプト | [prompts/extract_job.md](prompts/extract_job.md), [prompts/extract_talent.md](prompts/extract_talent.md) | LLM 用プロンプト |
| 16 | **提案比較・開発方針** | [docs/提案比較と開発方針.md](docs/提案比較と開発方針.md) | ①スプシ版 vs ②専用システム版、推奨ストーリー |
| 17 | **提案① スプシ版** | [proposal-a-spreadsheet/](proposal-a-spreadsheet/) | Apps Script 設計・シート定義例 |
| 18 | **提案② 専用システム版** | [proposal-b-webapp/](proposal-b-webapp/) | MVP/本番スコープ、共通設計への参照 |

---

## パイプライン概要

1. **集約** → 4名のメールを専用アカウントに転送
2. **Ingest** → 本文・添付・URLを保存（原本保全）
3. **Normalize** → 署名/引用除去、分割、重複検知
4. **Classify** → 案件 / 人材 / 混在 / その他
5. **Extract** → 固定JSON + confidence + 根拠行
6. **Canonicalize** → スキル辞書・駅・単価・雇用形態の正規化
7. **Resolve** → 同一人物/同一案件の名寄せ（自動＋手動）
8. **Search** → AND/OR/NOT、プリセット、保存条件
9. **Match** → Hard Filter → Score(0–100) → 理由生成
10. **Assist** → 提案メール/電話メモ生成（送信は人）

---

## 最短の作り方（2週間で動く MVP）

ゴール：**新着取り込み → 抽出 → 検索 → 簡易マッチ** まで動く MVP。

1. **固定スキーマをコードで確定**  
   [schemas/project-extract.json](schemas/project-extract.json)（案件）, [schemas/talent-extract.json](schemas/talent-extract.json)（人材）を正とする。抽出プロンプトは [prompts/extract_job.md](prompts/extract_job.md) / [prompts/extract_talent.md](prompts/extract_talent.md)。

2. **取り込みは最初「手動 .eml 投入」でよい**  
   Gmail 連携は後回し。.eml をパースして `raw_emails` / 添付を保存し、**抽出と DB 化を先に固める**。入力源は後から差し替え可能（[docs/取り込み仕様.md](docs/取り込み仕様.md)）。

3. **名寄せは「候補提示」だけ先に作る**  
   100% 自動統合は後でよい。[docs/名寄せ_初期アルゴリズム.md](docs/名寄せ_初期アルゴリズム.md)の同一判定キー・添付ハッシュで「同一っぽい候補を出す」→ 人が確定。

4. **docs は [docs/README.md](docs/README.md) で一覧**。スキーマは Prisma を正とし、`schema/prisma/schema.prisma` から生成。

---

## 次のステップ

- **メール本文サンプル（人材10〜20通）**が揃い次第、抽出スキーマ最終確定・スキル辞書初版・NG条件テンプレ・重み調整が可能です。
- 実装はロードマップに従い、MVP1（台帳化・検索・辞書）→ MVP2（マッチ・理由・名寄せ手動）→ 最強版（名寄せ自動・商流最適・分析）の順で進めることを推奨します。
