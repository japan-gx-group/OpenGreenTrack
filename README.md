# OpenGreenTrack - GHG排出量算定・管理ツール

[![CI](https://github.com/japan-gx-group/OpenGreenTrack/actions/workflows/ci.yml/badge.svg)](https://github.com/japan-gx-group/OpenGreenTrack/actions/workflows/ci.yml)

OpenGreenTrack は企業向けの温室効果ガス（GHG）排出量算定・可視化・管理プラットフォームです。Scope 1 / 2 / 3 を横断し、拠点別・カテゴリ別の排出量を集計して、経営層から現場まで意思決定に活かせるダッシュボードを提供します。

---

## 主要機能

- ダッシュボード
  - 総排出量、カテゴリ別推移、削減進捗を可視化
- データ入力
  - Scope 1・2 と Scope 3 積上げを1つのフォームで入力
  - 入力履歴の検索・編集・削除
- Scope 分析
  - Scope 1 / 2 / 3 の構成・推移分析
- 排出係数管理
  - 公的係数マスタとの連携
  - 拠点別 / 事業部別のカスタム係数設定
- 拠点管理
  - 拠点ごとの排出量、稼働状況、データ連携状況
- レポート出力
  - PDF / CSV エクスポート

---

## 対象ユーザー

- 環境推進部門
- サステナビリティ担当者
- 拠点のエネルギー管理責任者
- 経営層、ESG/BCP 戦略担当者

---

## 技術スタック

| 技術 | 役割 |
|------|------|
| Next.js（App Router） | フロントエンドフレームワーク。ファイルベースルーティング・Server Components |
| React | UIコンポーネント |
| TypeScript | 静的型付け |
| Supabase | バックエンド基盤（PostgreSQL / Auth / RLS） |
| Tailwind CSS + CSS Variables | 緑基調のデザイン（`src/styles/globals.css`） |
| recharts | グラフ・チャート描画 |
| lucide-react | アイコン |
| clsx | クラス名結合ユーティリティ |

依存ライブラリは**最新安定版**を使用します（プレリリース版は不可）。バージョン方針・開発規約の正本は [`AGENTS.md`](AGENTS.md) を参照してください。

アーキテクチャの全体像は [`docs/architecture.md`](docs/architecture.md)、ディレクトリ構成は [`docs/directory-structure.md`](docs/directory-structure.md) を参照してください。

---

## 開発環境セットアップ

詳しい手順は [`docs/setup-guide.md`](docs/setup-guide.md) を参照してください。
セットアップ方法は、目的に応じて 2 つあります。

| 経路 | 用途 | 主な流れ |
|---|---|---|
| ローカルで動かす（推奨） | まず無料で試す、開発する | Docker + Supabase CLI → `npx supabase start` → `npm run db:reset:demo` → `npm run dev` |
| クラウドで運用する | チーム利用、本番利用 | Supabase プロジェクト作成 → `npx supabase link --project-ref xxx` → `npx supabase db push --include-seed` → `.env.local` にクラウドの値を設定 |

Docker をインストールできない会社 PC では、クラウドで運用する経路を選んでください。macOS / Windows でのターミナル操作や Docker 未導入時の対応も [`docs/setup-guide.md`](docs/setup-guide.md) に記載しています。

### 最短手順

```bash
git clone <リポジトリURL>
cd OpenGreenTrack
npm install
```

> `npm install` 時に [lefthook](https://github.com/evilmartians/lefthook) が Git フック（`pre-commit`）を自動セットアップします。
> 以降、コミット時にステージした `.ts` / `.tsx` に自動で `eslint --fix` がかかり、CI が赤くなる前にローカルで整えられます。
> どうしてもスキップしたい場合は `git commit --no-verify` を使えますが、同じ lint は CI 側でも実行されます。

### 環境変数

```bash
cp .env.example .env.local
```

- ローカルで動かす場合は `npx supabase start` が表示するローカル用 URL / キーを設定します
- クラウドで運用する場合は Supabase Dashboard の Project Settings から URL / キーを取得します
- `.env.example` はコミットして共有する（サンプル値のみ）
- **`.env.local` は機密情報を含むため、決してコミットしない**（`.gitignore` 済み）
- `SUPABASE_SERVICE_ROLE_KEY` は管理者権限キーのため、サーバ側でのみ使用する（クライアントコードでの参照禁止）

### 開発サーバー起動

```bash
npm run dev
```

ブラウザで **http://localhost:3000** にアクセスします（ポートは `3000` に固定）。

---

## Supabase セットアップ

ローカルで試す場合:

```bash
npx supabase start
npm run db:reset:demo   # DB を作り直し、公式排出係数マスタ + デモデータを投入
```

クラウドで運用する場合:

```bash
npx supabase link --project-ref <Project Ref>
npx supabase db push --include-seed   # マイグレーション + 公式排出係数マスタを反映
```

`supabase db reset` はローカル DB を作り直すコマンド、`supabase db push` はクラウド DB へマイグレーションを反映するコマンドです。
Supabase CLI は `npx supabase …` で実行します（`npm run db:*` も内部で `npx supabase` を呼びます）。Homebrew 等で入れた `supabase` を併用する場合は、同じメジャーバージョンに揃えてください。

- `supabase/migrations/` はテーブル定義など **DDL 専用**（データは置かない）で、データは `supabase/seeds/` にあります。
- `supabase/seeds/production/`（公式排出係数マスタ）は `supabase db reset` / `supabase db push --include-seed` で自動的に投入されます。
- `supabase/seeds/demo/`（デモ組織・デモユーザー `org-a@example.com` / `password123` を含むデモデータ）は `npm run db:reset:demo` または `npm run db:seed:demo` で明示的に入れたときだけ投入されます。**本番には入れないでください。**

手順の詳細とつまずきやすい点は [`docs/setup-guide.md`](docs/setup-guide.md)、シードとコマンドの一覧は [`supabase/README.md`](supabase/README.md) を参照してください。

---

## コマンド一覧

| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバー起動（http://localhost:3000） |
| `npm run build` | 本番ビルド |
| `npm run start` | 本番ビルドの起動 |
| `npm run lint` | ESLint 実行 |
| `npm run test` | テスト実行（vitest） |
| `npm run test:watch` | テストをウォッチモードで実行 |
| `npm run test:e2e` | E2Eスモークテスト実行（Playwright / ローカルSupabase必須） |
| `npm run test:e2e:ui` | E2Eスモークテストを UI モードで実行 |
| `npm run test:e2e:install` | E2E用のブラウザ（Chromium）をダウンロード（初回のみ） |
| `npm run db:reset` | ローカル DB を作り直す（マイグレーション + 公式排出係数マスタ） |
| `npm run db:reset:demo` | ローカル DB を作り直し、デモデータまで投入する |
| `npm run db:seed:demo` | 起動中のローカル DB にデモデータ（`supabase/seeds/demo/demo.sql`）を投入する |
| `npm run db:seed:production` | 起動中のローカル DB に公式排出係数マスタを（再）投入する |
| `npm run check:migrations` | `supabase/migrations/` にデータ操作（DML）が混入していないか検査する |

---

## ドキュメント

ドキュメントはすべて日本語です（ファイル名は英語 kebab-case に統一）。
_All documentation is written in Japanese._

| ドキュメント | 内容 |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **開発規約の正本**（AIエージェント・人間共通。必読） |
| [`docs/architecture.md`](docs/architecture.md) | Next.js + Supabase のアーキテクチャ |
| [`docs/coverage-and-limitations.md`](docs/coverage-and-limitations.md) | 算定の対応範囲と限界（対象ガス・Scope 2 の方式・Scope 3・検証されている範囲） |
| [`docs/directory-structure.md`](docs/directory-structure.md) | ディレクトリ構成規約 |
| [`docs/setup-guide.md`](docs/setup-guide.md) | ローカル / クラウドのセットアップ手順 |
| [`docs/e2e-testing.md`](docs/e2e-testing.md) | E2Eスモークテスト（Playwright）の前提・実行方法 |
| [`docs/functional-spec.md`](docs/functional-spec.md) | 機能仕様（画面・URL・列挙型・バリデーション規則・算定ロジック概要） |
| [`docs/database-design.md`](docs/database-design.md) | DB 物理設計（テーブル・カラム定義） |
| [`docs/calculation-logic.md`](docs/calculation-logic.md) | 算定ロジックの詳細（係数解決・単位換算・未算定の扱い） |
| [`docs/idea-scope3-spec.md`](docs/idea-scope3-spec.md) | Scope 3 積上げ（IDEA データベース連携）の仕様 |

---

## セキュリティと運用上の注意

- ブラウザに公開してよい環境変数は `NEXT_PUBLIC_` プレフィックス付きのもののみ
- `SUPABASE_SERVICE_ROLE_KEY` は RLS をバイパスする管理者キー。必ずサーバー側でのみ利用する
- `.env.local` を誤ってコミットした場合は、速やかに該当キーをローテーション（Supabase で再発行）する
- CI/CD 用のシークレットは GitHub Actions / Vercel 等の Secrets 管理機能を使用する
- IDEAデータベース取込（`POST /api/idea-imports`）は数十MBの Excel をアップロードするため、**リクエストボディ制限のあるホスティング（Vercel の 4.5MB 等）では動作しない**。セルフホスト（またはボディ制限・メモリを設定できる環境）を前提とする（詳細は [`docs/setup-guide.md`](docs/setup-guide.md) の 2-F）
- 脆弱性を発見した場合は公開 Issue ではなく [`SECURITY.md`](SECURITY.md) の手順で報告してください

---

## コントリビューション

バグ報告・機能提案・コード貢献を歓迎します 🌱

- 貢献の進め方 → [`CONTRIBUTING.md`](CONTRIBUTING.md)
- 開発規約（正本・必読） → [`AGENTS.md`](AGENTS.md)
- 行動規範 → [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

---

## ライセンス

本プロジェクトは [Apache License 2.0](LICENSE) の下で公開されています。
