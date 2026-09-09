# コントリビューションガイド

GreenTrack へのご関心ありがとうございます 🌱
このドキュメントは、バグ報告・機能提案・コード貢献の進め方をまとめたものです。

> 開発規約の**正本**は [`AGENTS.md`](AGENTS.md) です。コードを書く前に必ず目を通してください。
> このファイルはコントリビューションの**手順**、`AGENTS.md` は**守るべきルール**を扱います。

---

## 目次

- [行動規範](#行動規範)
- [はじめる前に](#はじめる前に)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [Issue を立てる](#issue-を立てる)
- [ブランチ運用](#ブランチ運用)
- [コミットメッセージ](#コミットメッセージ)
- [Pull Request の流れ](#pull-request-の流れ)
- [コミット前チェックリスト](#コミット前チェックリスト)

---

## 行動規範

すべての参加者は [行動規範（Code of Conduct）](CODE_OF_CONDUCT.md) に従うものとします。

## はじめる前に

- 大きな変更や新機能は、**実装前に Issue で提案**してください。方針がずれた実装をレビュー段階で作り直すのを避けるためです。
- 新しいライブラリの追加は原則行いません。必要な場合は実装せず Issue / PR コメントで提案してください（詳細は [`AGENTS.md`](AGENTS.md) の「技術スタック」を参照）。

## 開発環境のセットアップ

前提: **Node.js 24 以上**

```bash
# 1. フォーク & クローン
git clone https://github.com/<your-account>/JGX-GXTechnology-GHG-Tool.git
cd JGX-GXTechnology-GHG-Tool

# 2. 依存インストール（lefthook の git hook も自動セットアップされます）
npm install

# 3. 環境変数を用意（.env.example をコピーして値を埋める）
cp .env.example .env.local

# 4. ローカル DB を用意（Docker 必須。詳細は docs/setup-guide.md）
npx supabase start       # ローカル Supabase を起動
npm run db:reset:demo    # マイグレーション + 本番マスタ + デモデータで DB を作り直す

# 5. 開発サーバ起動 → http://localhost:3000
npm run dev
```

`.env.local` は**絶対にコミットしない**でください。`SUPABASE_SERVICE_ROLE_KEY` などの秘密情報の扱いは [`AGENTS.md`](AGENTS.md) の R7 を参照。

ローカル DB の作り直しやシード（本番マスタ / デモデータ）の流し方は [`supabase/README.md`](supabase/README.md) を、マイグレーションの運用ルール（既存ファイルを編集しない・データを入れない）は [`AGENTS.md`](AGENTS.md) の R9 / R12 を参照してください。

## Issue を立てる

- バグ報告・タスクは [Issue テンプレート](.github/ISSUE_TEMPLATE/) を使ってください。
- **セキュリティ上の脆弱性は公開 Issue に書かないでください。** 報告方法は [`SECURITY.md`](SECURITY.md) を参照。

## ブランチ運用

`main` を安定ブランチとし、作業はトピックブランチで行います。

**ブランチ名の形式:**

```
<type>/<issue番号>-<短い説明>
```

例:

| 目的 | ブランチ名の例 |
|---|---|
| 新機能 | `feature/34-ghg-calculation-engine` |
| バグ修正 | `fix/57-dashboard-total` |
| ドキュメント | `docs/62-update-readme` |
| リファクタ | `refactor/40-locations-service` |
| 雑務・設定 | `chore/60-configure-lefthook` |

- `main` へ直接 push しないでください。必ず PR 経由でマージします。
- 1 つのブランチ / PR では、**担当 Issue の範囲だけ**を変更します（「ついで」の変更を混ぜない）。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/) に従います。

```
<type>: <日本語または英語の要約>
```

主な `type`:

| type | 用途 |
|---|---|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみ |
| `refactor` | 挙動を変えない内部改善 |
| `test` | テストの追加・修正 |
| `chore` | ビルド・設定・依存など |
| `ci` | CI 設定 |

例: `feat: GHG自動算定エンジンを実装`

## Pull Request の流れ

1. `main` から最新を取り込み、トピックブランチを作成する
2. 変更を実装し、[コミット前チェックリスト](#コミット前チェックリスト)をすべて通す
3. PR を作成する（[PR テンプレート](.github/PULL_REQUEST_TEMPLATE.md)が自動で開きます）
   - 関連 Issue を `Closes #34` のように記載する
   - 何を・なぜ変えたかを説明する
4. **CI（lint / test / build / check:migrations）がグリーン**になっていることを確認する
5. レビューを受け、指摘に対応する
6. 承認後にマージ（原則 Squash merge）

> ⚠️ **強制マージ（Force Merge）や CI・レビューのチェック上書き（Override）は禁止**です。
> テストが赤い・レビュー未承認の場合は、根本原因を修正してから通常マージしてください（[`AGENTS.md`](AGENTS.md) R11）。

## コミット前チェックリスト

コミット / PR 前に、ローカルで以下がすべて通ることを確認してください。

```bash
npm run lint              # ESLint が通る
npm run build             # 本番ビルドが通る
npm run test              # テストが通る
npm run check:migrations  # マイグレーションを触った場合
```

**lefthook（git フック）が自動実行するのは一部だけです。** pre-commit で走るのは次の2つで、`build` と `test` は走りません（`lefthook.yml`）。

| フック | 実行条件 | 内容 |
|---|---|---|
| `lint` | `*.ts` / `*.tsx` をステージしたとき | ステージしたファイルに `eslint --fix`（修正結果は自動で再ステージ） |
| `check-migrations` | `supabase/migrations/*.sql` をステージしたとき | マイグレーションに DML が混入していないか検査（`AGENTS.md` R12） |

`build` と `test` の失敗はフックでは検出できないため、**push 前に上記4つを自分で流してください**。強制力の本丸は CI 側（lint / test / build / check:migrations / シークレット走査）です。

あわせて [`AGENTS.md`](AGENTS.md) 末尾の「してはいけないことチェックリスト」も確認してください。

---

ご不明点は Issue または PR コメントでお気軽にどうぞ。貢献に感謝します！ 🙌
