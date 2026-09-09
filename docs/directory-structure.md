# ディレクトリ構成規約

このドキュメントは OpenGreenTrack リポジトリの**目標ディレクトリ構成**と、「各ディレクトリに**何を置くか / 置かないか**」を定義します。
規約の正本は [`AGENTS.md`](../AGENTS.md) です。矛盾がある場合は `AGENTS.md` が優先されます。

## 全体像

```
.
├── AGENTS.md                     # AIエージェント向けの構成ルール（ガードレール・正本）
├── CLAUDE.md                     # 「規約は AGENTS.md を参照」と書くだけの薄いファイル
├── .env.example                  # 環境変数の雛形（コミットする。実値は書かない）
├── .github/
│   ├── ISSUE_TEMPLATE/           # issueテンプレート
│   └── workflows/                # CI（lint / test / build / check:migrations）
├── docs/                         # 設計・規約ドキュメント（Markdown）
│   ├── architecture.md
│   ├── directory-structure.md    # ← このファイル
│   └── （機能仕様・DB設計等）
├── e2e/                          # Playwright の E2E スモークテスト
├── public/                       # 静的ファイル（favicon等）
├── scripts/                      # 開発用スクリプト（seed 投入・マイグレーション検査・公式係数の生成）
│   ├── db/                       # seed.ts / check-migrations.ts（テストは __tests__/、SQLフィクスチャは __fixtures__/）
│   └── official-factors/         # 公式排出係数 seed の生成元データと generate.ts
├── supabase/                     # Supabase migrations / seeds / config
│   ├── migrations/               # SQLマイグレーション（DDL のみ。データ禁止）
│   └── seeds/
│       ├── production/           # 本番でも投入する共通マスタ（公式排出係数）
│       └── demo/                 # デモ・テスト用データ（本番投入禁止）
├── src/
│   ├── app/                      # App Router：ルーティングとページのみ
│   ├── components/               # ドメインに依存しない共有UI
│   │   ├── ui/                   # shadcn/ui の汎用プリミティブ（button, card, badge, dialog…）
│   │   └── layout/               # Sidebar, AppTopBar, PageHeading など
│   ├── features/                 # ★機能（ドメイン）別に凝集
│   ├── lib/                      # supabaseクライアント・共通util（testing/ はテスト専用ヘルパー）
│   ├── contexts/                 # 全体共有Context（例: FiscalYear）
│   ├── hooks/                    # 全体共有hook
│   ├── types/                    # 全体共有の型
│   ├── styles/                   # globals.css など
│   └── proxy.ts                  # Next.js のミドルウェア（認証ガード。旧 middleware.ts に相当）
└── package.json
```

単体テスト（`*.test.ts` / `*.test.tsx`）は、テスト対象と同じディレクトリ直下の `__tests__/` に置きます（`AGENTS.md` R13）。
上のツリーでは省略していますが、`src/` と `scripts/` のどの階層にも `__tests__/` が現れます。

## 各ディレクトリの「置くもの / 置かないもの」

### `src/app/` — ルーティング専用

- **置くもの:** `page.tsx` / `layout.tsx` / `loading.tsx` / `error.tsx` / `route.ts`（Route Handler）などApp Routerの規約ファイル。ページは `features/` のコンポーネントを呼ぶだけの薄いファイルにする
- **置かないもの:** ビジネスロジック、データ取得の実装、巨大なUI実装、型定義

画面は 2 つの**ルートグループ**（括弧付きディレクトリ。URL には現れない）に分かれる:

```
src/app/
├── layout.tsx        # <html>/<body>・フォント・globals.css だけ（シェルや Provider は持たない）
├── error.tsx / global-error.tsx   # どのグループにも属さない（シェル無しで描かれる）
├── (app)/            # 認証済み画面。layout.tsx がサイドバー・パンくずバー・各 Context を 1 回だけ組み立てる
│   ├── layout.tsx
│   ├── page.tsx      # `/` → /dashboard へリダイレクト
│   ├── not-found.tsx / [...not-found]/page.tsx   # 404（一致しない URL をこのグループへ引き込み、シェル付きで描く）
│   ├── dashboard/ data-input/ scope-analysis/ factors/ locations/ reports/ settings/
├── (auth)/           # 認証画面。layout.tsx が AuthLayout（ブランドパネル + フォーム面）を 1 回だけ描く
│   ├── layout.tsx
│   ├── login/ signup/ forgot-password/ reset-password/ invite/[token]/
│   └── auth/callback/route.ts
└── api/              # Route Handler（グループに属さない）
```

- **新しい画面を足すときは、ログイン後の画面なら `(app)/`、未ログインで開く画面なら `(auth)/` に置く**。ルート直下に `page.tsx` を持つディレクトリを作らない
- `(auth)/` に画面を足したら、ミドルウェア用の公開パス一覧 `src/lib/security/authPaths.ts` も更新する（ミドルウェアはディレクトリ構成を知らないため、この一覧だけは手で一致させる）
- サイドバー等の出し分けを `usePathname()` で行わない（グループのレイアウトが担う）

現在のルート一覧:

| URL | ファイル | 画面 |
|---|---|---|
| `/` | `src/app/(app)/page.tsx` | `/dashboard` へリダイレクト |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` | ダッシュボード |
| `/data-input` | `src/app/(app)/data-input/page.tsx` | データ入力 |
| `/scope-analysis` | `src/app/(app)/scope-analysis/page.tsx` | Scope分析 |
| `/factors` | `src/app/(app)/factors/page.tsx` | 排出係数管理 |
| `/locations` | `src/app/(app)/locations/page.tsx` | 拠点管理 |
| `/locations/[locationId]` | `src/app/(app)/locations/[locationId]/page.tsx` | 拠点詳細（拠点別の排出量・活動量） |
| `/reports` | `src/app/(app)/reports/page.tsx` | レポート出力 |
| `/reports/print` | `src/app/(app)/reports/print/page.tsx` | レポート印刷ビュー |
| `/login` | `src/app/(auth)/login/page.tsx` | ログイン |
| `/forgot-password` | `src/app/(auth)/forgot-password/page.tsx` | パスワード再設定メールの送信 |
| `/reset-password` | `src/app/(auth)/reset-password/page.tsx` | 新しいパスワードの設定（メールリンク経由のみ） |
| `/auth/callback` | `src/app/(auth)/auth/callback/route.ts` | メールリンク（パスワード再設定など）からのコールバック（Route Handler） |
| `/signup` | `src/app/(auth)/signup/page.tsx` | 初期セットアップ（組織0件時のみ） |
| `/invite/[token]` | `src/app/(auth)/invite/[token]/page.tsx` | 招待受諾 |
| `/settings/account` | `src/app/(app)/settings/account/page.tsx` | アカウント設定 |
| `/settings/company` | `src/app/(app)/settings/company/page.tsx` | 企業情報設定 |

Route Handler（API）:

| URL | ファイル | 用途 |
|---|---|---|
| `/api/calculations` | `src/app/api/calculations/route.ts` | 排出量の再計算実行 |
| `/api/calculations/provisional-recalculation` | `src/app/api/calculations/provisional-recalculation/route.ts` | 暫定適用のまま残った算定済みデータの検出（GET）と再算定対象への差し戻し（POST） |
| `/api/dashboard-aggregates/refresh` | `src/app/api/dashboard-aggregates/refresh/route.ts` | ダッシュボード集計（dashboard_aggregates）の再計算 |
| `/api/idea-imports` | `src/app/api/idea-imports/route.ts` | IDEA データベース（Excel）の取込開始 |
| `/api/idea-imports/[id]` | `src/app/api/idea-imports/[id]/route.ts` | IDEA 取込の削除 |
| `/api/account/delete` | `src/app/api/account/delete/route.ts` | アカウント削除 |
| `/api/health` | `src/app/api/health/route.ts` | ヘルスチェック（DB接続確認・readiness probe） |
| `/api/csp-report` | `src/app/api/csp-report/route.ts` | CSP違反レポートの受信（本体は `src/lib/security/cspReport.ts`） |

### `src/features/<domain>/` — 機能（ドメイン）別のまとまり

- **置くもの:** その機能専用の `components/` `hooks/` `services/` `types.ts`
  - `components/` のうち Client Component（先頭に `'use client'`）は **`<Name>.client.tsx`**、Server Component は `<Name>.tsx`（`AGENTS.md` R6。ESLint が突き合わせを強制する）
  - 任意で置いてよいサブディレクトリ:
    - `utils/` — Supabase に触れない純粋なヘルパー（例: `factors/utils/factorSources.ts`、`scope-analysis/utils/treemapLayout.ts`）。`services/` は「データ取得・保存」、`utils/` は「入出力のない変換・計算」と使い分ける
    - `engine/` — 純粋な算定エンジン（`calculation/engine/` のみ。`computeEmissions` / `resolveEmissionFactor` / `units`）。DB アクセスは `calculation/services/` 側に置き、エンジンは入力→出力の純関数に保つ
- **置かないもの:** 他の機能から使い回すもの（→ `src/components/` や `src/hooks/` へ）
- 現在のdomain一覧: `auth`, `calculation`, `dashboard`, `data-input`, `factors`, `locations`, `notifications`, `reports`, `scope-analysis`, `settings`, `targets`
  - 必要なサブディレクトリだけを持つ（例: `notifications/` は `services/` のみ、`calculation/` は `engine/` と `services/` のみで `components/` を持たない）

```
src/features/locations/
├── components/       # Locations.client.tsx（拠点一覧）, LocationDetail.client.tsx（拠点詳細）
├── components/
│   └── __tests__/    # Locations.client.test.tsx（コンポーネントのテスト）
├── services/         # locationService.ts / locationDetailService.ts（Supabaseアクセス）、
│   │                 # locationCsvImport.ts / locationDeletionGuard.ts / locationDetailAggregation.ts（純関数）
│   └── __tests__/    # 上記の *.test.ts
└── types.ts          # LocationRecord など拠点専用の型
```

### `src/components/` — ドメインに依存しない共有UI

- **置くもの:**
  - `ui/`: どの画面でも使える汎用部品。shadcn/ui の CLI（`npx shadcn@latest add`）で追加したコンポーネント（`button.tsx` `card.tsx` `badge.tsx` `dialog.tsx` など。設定は `components.json`）と、このアプリ固有の汎用部品（`Modal` `Pagination` `SearchableSelect` など）
  - `layout/`: アプリの骨格（`Sidebar` / `AppTopBar`（パンくずバー）/ `PageHeading`（画面見出し）/ `FiscalYearMenu` / `NotificationBell` / `navItems.ts`（ナビ定義の正本））
- **置かないもの:** 特定機能専用のコンポーネント（→ `features/<domain>/components/` へ）

### `src/lib/` — 共通基盤

- **置くもの:** 2つ以上の機能から使う共通基盤。性質ごとにサブディレクトリへ分け、どこにも属さない単体のutilだけを直下に置く
  - `supabase/` — Supabase クライアント生成（`client.ts` / `server.ts` / `admin.ts`）
  - `logging/` — 構造化ログ（`logger.ts` / `requestLogger.ts` / `clientLogger.ts`）
  - `security/` — ミドルウェアと API の防御（`securityHeaders.ts` / `cspReport.ts` / `rateLimit.ts` / `apiRateLimit.ts` / 公開パス一覧 `authPaths.ts`）
  - `fiscal-year/` — 会計年度の期間計算と年度解決（`fiscalYearPeriod.ts` / `fiscalYearLookup.ts`）
  - `files/` — ブラウザでのファイル入出力（`csv.ts` / `download.ts`）
  - `testing/` — UIコンポーネントテスト用の軽量レンダリングヘルパー（テスト専用）
  - 直下 — `currentProfile.ts`（ログイン中ユーザーのサーバ側取得）、`supabaseRows.ts`（PostgREST の全件取得・IN 分割）、`datetime.ts` / `email.ts` / `pagination.ts`（単体の純粋なutil）
- **置かないもの:** Reactコンポーネント、機能固有のロジック
- サブディレクトリを増やす目安: 同じ性質のファイルが2本以上になり、互いに import し合うようになったら（1本だけのために作らない）

### `src/contexts/` / `src/hooks/` / `src/types/` — 全体共有のみ

- **置くもの:** 2つ以上の機能から実際に使われるContext / hook / 型（例: `FiscalYearContext`、`AppRefreshContext`（ヘッダーの「最新データに更新」を各画面の取得に配る））
- **置かないもの:** 1機能でしか使わないもの（→ `features/<domain>/` へ）

### `src/styles/`

- **置くもの:** `globals.css`（`@theme` のデザイントークン・リセット・共通パーツ。カード/テーブル/フォーム/ボタン/メニューの見た目は `gt-*` クラスに集約してある）
- **置かないもの:** ページ固有の巨大CSS（可能な限りCSS Variablesと既存クラスで構成する）

### `supabase/`

- **置くもの:** `migrations/*.sql`（テーブル・RLS・RPC などの **DDL のみ**。v1.0 初期スキーマは `schema` / `rls` / `rpc` / `storage` の 4 本で、以降は `supabase migration new <name>` で新規ファイルを追加する）、`seeds/production/*.sql`（本番でも投入する共通マスタ。公式排出係数）、`seeds/demo/*.sql`（デモ・テスト用データ）、`config.toml`
- **置かないもの:** `.env`・アクセスキー類（gitignore対象）、**`migrations/` 内のデータ操作**（`insert` / `update` / `delete` などのデータ投入・訂正は `seeds/` へ。`AGENTS.md` R12。`storage.buckets` の定義・設定変更（`insert` / `update`）だけは例外）、`seeds/production/` へのデモ・テスト用データ
- 詳細（各ファイルの中身・シードの流し方・コマンド一覧）は [`supabase/README.md`](../supabase/README.md) を参照

### `e2e/`

- **置くもの:** Playwright のE2Eスモークテスト（`*.spec.ts` / `auth.setup.ts` / `support/`）
- **置かないもの:** 純関数・UIコンポーネントの単体テスト（→ 対象コードと同じディレクトリの `__tests__/` に `*.test.ts` / `*.test.tsx` として置く。`AGENTS.md` R13）
- 前提・実行方法は [`docs/e2e-testing.md`](e2e-testing.md) を参照

### `docs/`

- **置くもの:** Markdownのドキュメントのみ（機能仕様・DB設計・規約類）
- **置かないもの:** `.docx` などのバイナリファイル
