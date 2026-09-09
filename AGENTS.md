# AGENTS.md — AIエージェント向け開発規約（正本）

このファイルは **GreenTrack（GHG排出量算定ツール）** リポジトリの開発規約の**正本**です。
Codex / Claude Code / Fable など、**どのAIエージェントで作業する場合も必ずこのルールに従ってください。**
人間の開発者も同じルールに従います。迷ったらこのファイルに立ち返ること。

> 関連ドキュメント:
> - ディレクトリ構成の詳細 → [`docs/directory-structure.md`](docs/directory-structure.md)
> - アーキテクチャ全体像 → [`docs/architecture.md`](docs/architecture.md)
> - 画面・URL・バリデーション規則 → [`docs/functional-spec.md`](docs/functional-spec.md)
> - DB マイグレーション・シードの運用 → [`supabase/README.md`](supabase/README.md)

---

## 1. 技術スタック（これ以外を勝手に導入しない）

| 領域 | 採用技術 | 備考 |
|---|---|---|
| フレームワーク | **Next.js（App Router）** | Pages Router は使わない |
| 言語 | TypeScript | `any` の乱用禁止 |
| バックエンド/DB | **Supabase**（Postgres / Auth / RLS） | 自前APIサーバ・ORM は挟まない |
| スタイル | **Tailwind CSS + CSS Variables**（緑基調） | CSS-in-JS は導入しない。Tailwindをメインに、変数管理でVanilla CSSを併用 |
| グラフ | recharts | |
| アイコン | lucide-react | |
| ユーティリティ | clsx | |

### 絶対ルール
- ❌ **新しいライブラリを勝手に追加しない。** 追加が必要だと思ったら、実装せずに issue / PR コメントで提案する
- ❌ **別のビルドツール・ルーター・ORM を導入しない**（このリポジトリは Next.js（App Router）+ Supabase 構成）
- ✅ 依存を更新する場合は**その時点の最新安定版**を使う（プレリリース/RC禁止、`^` キャレット指定）

---

## 2. ディレクトリ規約（最重要）

```
src/
├── app/          # ルーティングとページのみ。「薄く」保つ
├── components/   # ドメインに依存しない共有UI
│   ├── ui/       # 汎用プリミティブ（Badge, Card など）
│   └── layout/   # Header, Sidebar など
├── features/     # ★機能（ドメイン）ごとに凝集
│   └── <domain>/
│       ├── components/
│       ├── hooks/
│       ├── services/
│       └── types.ts
├── lib/          # Supabaseクライアント・共通util
├── contexts/     # アプリ全体で共有するContext（例: FiscalYear）
├── hooks/        # アプリ全体で共有するhook
├── types/        # アプリ全体で共有する型
└── styles/       # globals.css
```

### ルール（良い例 / ダメな例つき）

**R1. 新規ページは `src/app/(app)/<route>/page.tsx`（ログイン後の画面）または `src/app/(auth)/<route>/page.tsx`（未ログインで開く画面）に作る**

- `(app)` / `(auth)` はルートグループ（URL には現れない）。`(app)/layout.tsx` がサイドバー・パンくずバー・各 Context を、`(auth)/layout.tsx` が認証画面の2カラムシェルを 1 回だけ組み立てる。画面側でサイドバーの出し分けをしない
- `(auth)/` に画面を足したら、ミドルウェア用の公開パス一覧 `src/lib/security/authPaths.ts` も更新する
- ✅ 良い例: `/reports` のページ → `src/app/(app)/reports/page.tsx`
- ✅ 良い例: `/login` のページ → `src/app/(auth)/login/page.tsx`
- ❌ ダメな例: `src/app/reports/page.tsx` をルート直下に作る（どちらのグループにも属さず、シェル無しで描かれる）
- ❌ ダメな例: `src/pages/Reports.tsx` を作る（Pages Router 形式。禁止）
- ❌ ダメな例: `src/app/reports.tsx` を作る（App Router では `<route>/page.tsx` 形式）

**R2. `app/` は「薄く」。ロジック・UIの本体は `features/<domain>/` に置く**

- ✅ 良い例:
  ```tsx
  // src/app/(app)/locations/page.tsx — ページはfeatureを呼ぶだけ
  import { LocationsPage } from '@/features/locations/components/LocationsPage';
  export default function Page() {
    return <LocationsPage />;
  }
  ```
- ❌ ダメな例: `src/app/(app)/locations/page.tsx` に500行のテーブル実装・fetch処理・型定義を全部書く

**R3. 「型別」ではなく「機能別」に置く**

- ✅ 良い例: 拠点管理のservice → `src/features/locations/services/locationService.ts`
- ✅ 良い例: 拠点管理でしか使わない型 → `src/features/locations/types.ts`
- ❌ ダメな例: `src/services/` `src/types/` に全機能のファイルを積み上げる
- 例外: **複数の機能で本当に共有するもの**だけ `src/hooks/` `src/types/` `src/contexts/` に置いてよい（例: `FiscalYearContext`）

**R4. 汎用UIだけ `src/components/` に置く**

- ✅ 良い例: どの画面でも使う `Badge` / `Card` → `src/components/ui/`
- ✅ 良い例: `Sidebar` / `Header` → `src/components/layout/`
- ❌ ダメな例: 拠点管理画面専用の `LocationTable` を `src/components/` に置く（→ `src/features/locations/components/` へ）

**R5. 色はトークン経由で。生の hex をコンポーネントに書かない**

- ✅ ブランド/意味を持つ色（primary success scope-1 等）は globals.css の `@theme` にだけ定義し、bg-primary text-scope-1 のように使う。`@theme` の値は `--color-primary` として :root にも出力されるため、recharts の色指定など className で書けない箇所は `var(--color-primary)` で参照する
- ❌ `:root { --primary: … }` のように `@theme` と別名の CSS 変数を重ねて定義する（同じ色の定義が 2 か所になり、片方だけ直す事故が起きる）
- ✅ 共通パーツ（`gt-*` など）は `@layer components` に書く。ユーティリティ層より下なので `gt-btn-primary bg-danger` のように個別の上書きができ、`!border-danger` のような `!important` は不要
- ✅ 中立グレーやデータ可視化の連続スケールは Tailwind 標準パレット（bg-gray-50 bg-emerald-300 等）を使ってよい
- ❌ コンポーネントに生の色（bg-[#10b981] / style={{ color: '#10b981' }}）。どうしても必要な一度きりの色のみ、理由コメント付きで例外

**R6. Server / Client コンポーネントの境界**

- デフォルトは Server Component。`useState` / `useEffect` / `onClick` / `localStorage` / recharts を使う部分**だけ** `'use client'` を付ける
- **`'use client'` を付けたコンポーネントファイルは `<Name>.client.tsx` と命名する**（`src/app/` の規約ファイル `page.tsx` / `layout.tsx` / `error.tsx` 等は除く）。ディレクトリ一覧を見ただけで Server / Client の境界が分かるようにするため。ESLint（`eslint.config.js` の `greentrack/client-component-filename`）が「`'use client'` があるのに `.client.tsx` でない」「`.client.tsx` なのに `'use client'` が無い」の両方をエラーにする
  - 対象は `.tsx` のコンポーネントのみ。hook（`use*.ts`）や Context の値ファイルは名前で役割が分かるため対象外
  - テストは対象と同じ名前にする: `Modal.client.tsx` → `__tests__/Modal.client.test.tsx`（R13）
  - 例外: `src/components/ui/` の shadcn/ui 生成ファイル（`select.tsx` `dialog.tsx` など小文字始まり）は shadcn CLI の命名規約に従い `.client` を付けない（付けると `npx shadcn add` の更新や部品同士の import が壊れる）。lint も小文字始まりのファイルだけ除外している（R14）
- ✅ 良い例: ページはServerのまま、グラフ部分だけ `'use client'` の子コンポーネント `Sparkline.client.tsx` に切り出す
- ✅ 良い例: `src/components/ui/GreenTrackMark.tsx`（hook を使わない表示だけの部品。Server Component のまま）
- ❌ ダメな例: とりあえず全ファイル先頭に `'use client'` を付ける
- ❌ ダメな例: `'use client'` を付けたまま `Modal.tsx` の名前で置く（lint エラー）

**R7. Supabase のキーの扱い**

- ✅ ブラウザで使ってよいのは `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` のみ（`src/lib/supabase/client.ts`）
- ❌ `SUPABASE_SERVICE_ROLE_KEY` を **クライアントコンポーネント・`NEXT_PUBLIC_` 変数・コミットするファイルに書くのは絶対禁止**（管理者権限キーのため）
- ❌ `.env.local` をコミットしない（`.env.example` のみコミット可）

**R8. ルーティングは App Router のファイルベースで行う**

- 別のルーターライブラリや独自のビルドツール設定を持ち込まない（ルーティングは `src/app/` のファイル配置で表現する）

**R9. マイグレーションファイルの不変性（変更は追加のみ）**

- `supabase/migrations/` 内の既存 SQL ファイルは絶対に編集・削除しないこと。
- スキーマ変更（テーブル・カラム・制約・インデックス・RLS ポリシー・RPC 関数など）は、常に新しいタイムスタンプ付きのマイグレーションファイルを新規作成して行う（`npx supabase migration new <name>`）。
- **v1.0 初期スキーマ**は次の 4 本（`supabase db reset` / `db push` はこの順に適用する。後のファイルは前のファイルのテーブル・関数に依存する）。以後のマイグレーションはこの 4 本の後ろに積み上げていき、**複数のマイグレーションを 1 本にまとめ直すことはしない**（squash は v1.0 リリース前に限る。リリース後は適用済みの DB が存在し、ファイルと `supabase_migrations.schema_migrations` の記録が食い違って `db push` が壊れるため）。
  - `20260831000000_schema.sql` — extension / 型 / テーブル / 制約 / インデックス / トリガー
  - `20260831000001_rls.sql` — RLS 補助関数 / RLS 有効化・ポリシー / テーブルの GRANT・REVOKE
  - `20260831000002_rpc.sql` — アプリが `supabase.rpc()` で呼ぶ関数と EXECUTE 権限
  - `20260831000003_storage.sql` — Storage バケット定義と `storage.objects` のポリシー
- ✅ 良い例: テーブルにカラムを追加するため、`npx supabase migration new add_column` で `supabase/migrations/<timestamp>_add_column.sql` を新規作成し、そこに `alter table … add column …` を書く。
- ❌ ダメな例: `supabase/migrations/20260831000000_schema.sql` を直接編集してカラムを追加する。
- ❌ ダメな例: 初期スキーマの 4 本と後から追加したマイグレーションをまとめ直して 1 本にする。

**R10. コードコメントの保持**

- リファクタリングや修正を行う際、明示的な指示がない限り、コード内の既存の開発者コメントや JSDoc を削除せず保持すること。
- ✅ 良い例: `src/features/locations/services/locationService.ts` を修正する際、ファイルの先頭にあるJSDocや注意書きのコメントをそのまま残して編集する。
- ❌ ダメな例: コードのリファクタリング中に、既存のコメント行が不要と判断して勝手にすべて削除する。
- コメント・JSDoc・テスト名に Issue / PR 番号（`#382` `issue #278` など）を書かない。経緯は番号ではなく事実として書く（「暫定適用で算定した結果は正式係数を入れても置き換わらないため」など）。番号を残したい場合はコミットメッセージや PR 本文に書く
- ❌ ダメな例: `// #382: 対象年度の公式係数が未公表の間は…`（番号は GitHub を見ないと意味が分からず、公開後の読者には辿れない）

**R11. 強制マージ・チェックの上書き禁止**

- Pull Request をマージする際、強制マージ（Force Merge）を行ったり、CIテストやレビューのチェックを意図的に上書き（Override）してマージしないこと。
- 不合格のステータスや指摘事項がある場合は、必ず根本原因を修正して解決すること。
- ✅ 良い例: テストエラーが出た場合、ブランチに戻ってコード修正を行い、再度CIテストがパスするのを確認してから通常マージする。
- ❌ ダメな例: PRのテストが赤色（エラー）のまま、またはレビュー承認がない状態で、GitHub上の管理者権限を使って強制マージ（Force Merge / Admin Override）する。

**R12. マイグレーションにデータを入れない（DDL 専用）**

- `supabase/migrations/` は**スキーマ定義（DDL）専用**。データ（DML）は書かず、`supabase/seeds/` に置く。
- ❌ 禁止: マイグレーション内の `insert` / `update` / `delete` / `copy` / `truncate` / `merge`。対象を問わず禁止（排出係数マスタ・組織・ユーザー・デモデータ・既存行のバックフィル・データ訂正のいずれも）
- ✅ 置いてよいのは DDL のみ: extension / type / table / column / constraint / index / function・RPC / trigger / policy / grant・revoke / comment on
- ✅ 唯一の例外: `storage.buckets` の定義と設定変更（`insert` / `update` のみ）。バケットはデータではなくインフラ設定であり、Supabase 公式の作成手段が SQL のため。`delete` / `truncate` は例外にしない。この例外に当たるのは `20260831000003_storage.sql` の 1 本だけ（アプリからの読み書き経路は現在無く、バケットの定義だけを置いている）
- ✅ データの置き場（seed）:
  - `supabase/seeds/production/` — **本番でも投入する共通マスタ**（公式排出係数など。`scripts/official-factors/generate.ts` が生成する）
  - `supabase/seeds/demo/` — **テスト・デモ専用**（デモ組織・ユーザー・サンプル活動量など。**本番投入禁止**）
- ✅ seed は**冪等**に書く（`on conflict … do nothing/update`、または削除→再投入）。production と demo は**互いに依存させない**（どちらか一方だけでも流せること）
- ✅ 既存データの訂正は **seed を直して再投入**する（seed は冪等 upsert なので再実行で上書きされる）。migration に `update` を書かない
- 機械チェック: `npm run check:migrations`（CI と lefthook の pre-commit で実行）が `supabase/migrations/` 内の DML を検出して失敗させる。限界: 関数本体（`$$ … $$` 内）の DML はアプリロジックとして検出対象外、`do $$ … $$` ブロック内の DML は検出する。チェックが通っても「データを入れていないか」は PR レビューで確認すること
- ✅ 良い例: 公式排出係数の出典を訂正する → `scripts/official-factors/data/` を直して `node scripts/official-factors/generate.ts` で seed を再生成し、`npm run db:seed:production` で再投入する
- ✅ 良い例: 新しい画面用のデモデータが欲しい → `supabase/seeds/demo/` に冪等な SQL を追加し、`npm run db:seed:demo`（または `npm run db:reset:demo`）で投入する
- ❌ ダメな例: `supabase/migrations/<timestamp>_fix_factor_source.sql` に `update emission_factors set source = …` を書く
- ❌ ダメな例: `supabase/migrations/<timestamp>_add_demo_org.sql` に `insert into organizations …` でデモ組織を入れる
- ❌ ダメな例: カラム追加のマイグレーションに、既存行の値を埋める `update … set new_column = …`（バックフィル）を同居させる（既定値が必要なら `default` 句で対応する）
- ❌ ダメな例: デモ用の組織・ユーザーを `supabase/seeds/production/` に混ぜる（本番に流れてしまう）

**R13. 単体テストは対象コードと同じディレクトリの `__tests__/` に置く**

- Vitest の単体テスト（`*.test.ts` / `*.test.tsx`）は、**テスト対象ファイルがあるディレクトリ直下の `__tests__/`** に、対象と同じファイル名で置く。実装ファイルの一覧にテストが混ざらず、かつ対象のすぐ隣にあるので「実装を開けばテストの場所が分かる」状態を保つ
- テスト専用のヘルパー（DOM レンダリング等）は `src/lib/testing/` に置く。テスト用の SQL フィクスチャは `scripts/db/__fixtures__/` のように、テストと同じ階層の `__fixtures__/` に置く
- 対応する実装ファイルが無いテスト（例: `supabase/migrations/*.sql` の文面を検証する回帰テスト）は、`scripts/db/__tests__/` に置く（feature の `services/` には置かない）
- E2E（Playwright）はルートの `e2e/` に置く（単体テストと混ぜない）
- ✅ 良い例: `src/features/locations/services/locationService.ts` のテスト → `src/features/locations/services/__tests__/locationService.test.ts`
- ✅ 良い例: `src/components/ui/Modal.client.tsx` のテスト → `src/components/ui/__tests__/Modal.client.test.tsx`
- ❌ ダメな例: `src/features/locations/services/locationService.test.ts`（実装の隣に直接置く）
- ❌ ダメな例: ルートに `tests/` を作って `src/` と同じ階層を複製する（実装を移すたびに二重に追従が必要になる）


---


**R14. 共通 UI 部品は shadcn/ui（`src/components/ui/`）を使う。見た目を CSS クラスで新設しない**

- `Button` `Badge` `Card` `Input` `Select` `Table` `Dialog` `DropdownMenu` `Tabs` などは `src/components/ui/` の shadcn/ui コンポーネントを使う。色・寸法は `globals.css` の `@theme` トークンと gt-* に合わせて調整済み
- 部品を増やすときは `npx shadcn@latest add <name>` で追加し、必要なら生成されたファイルをこの repo の見た目に合わせて編集する（コピーされた自分のコードなので編集してよい）
- ✅ 良い例: `<Button variant="outline" size="sm">キャンセル</Button>` / `<Badge variant="success">稼働中</Badge>`
- ❌ ダメな例: `globals.css` に `.my-btn { … }` を追加して `className="my-btn"` で使う（見た目の定義が CSS と TSX の 2 か所に分かれ、未使用になっても気づけない）
- ❌ ダメな例: `src/components/ui/` に shadcn 経由でない独自の Button を作る
- 既存の `gt-btn` `gt-card` `gt-pill` 等の CSS クラスは shadcn への移行が終わるまで残す。新規画面では shadcn 側を使うこと

**R15. 画面コンポーネントは「関心ごと」で分ける（行数は目安、境界は意味で決める）**

- 1 ファイルが 500 行を超えたら分割を「検討」する。機械的な上限ではなく、次の分割基準に当てはまるかで判断する（行数より優先）
  - `useState` / `useReducer` が 8 個を超えている
  - 変更理由が複数ある（例: 絞り込みの修正と CSV 取込の修正が同じファイルを触る）
  - 単体テストしたいロジック（絞り込み・集計・保存処理）が JSX と同じ関数の中にある
- 分け方
  - 状態とロジック → `features/<domain>/hooks/use<関心ごと>.ts`。**1 フック 1 関心ごと**（データ読込 / 絞り込み / 作成・編集 / 削除 / 取込 …）。画面全体を 1 フックにまとめない
  - 複数の画面で使う汎用のもの（ページング・トースト等）→ `src/hooks/`
  - 見た目 → `features/<domain>/components/<部品名>.client.tsx`
  - 画面本体（`<Screen>.client.tsx`）はフックを呼んで部品を組み立てるだけにする
- フック同士は直接依存させず、画面本体で組み合わせる（例: 絞り込みを変えたら 1 ページ目へ戻す処理は、絞り込みフックがページングフックを呼ぶのではなく、画面本体が `filters.setSelectedType(v); pagination.resetPage();` と並べて書く）
- 分割は挙動を変えない PR で行い、既存の画面テストが書き換えなしで通ることを確認する。挙動の変更（URL 同期・reducer 化など）は別 PR に分ける
- ✅ 良い例: `features/factors/hooks/useFactorFilters.ts`（絞り込みの状態と候補リスト・絞り込み結果の導出だけを持つ）＋ `src/hooks/usePagination.ts`（汎用ページング）＋ `Factors.client.tsx`（両者を呼んで JSX を組む）
- ❌ ダメな例: 行数を減らすためだけに、意味のない境界でファイルを 2 つに割る（`FactorsPart1.tsx` / `FactorsPart2.tsx`）
- ❌ ダメな例: `useFactorsPage` が 30 個の値を返す（画面全体を 1 フックに移しただけで、読みにくさが変わらない）

---

## 3. よく触るファイル（地図）

「どこを開けばいいか」を最短で辿るための一覧。規則の本体は §2、構成の詳細は [`docs/directory-structure.md`](docs/directory-structure.md)。

| やりたいこと | 開くファイル |
|---|---|
| 画面を足す・直す | `src/app/(app)/<route>/page.tsx`（薄いページ）→ 本体は `src/features/<domain>/components/<Name>.client.tsx` |
| 認証画面（ログイン・招待・再設定） | `src/app/(auth)/<route>/page.tsx` + `src/features/auth/components/` + 公開パス一覧 `src/lib/security/authPaths.ts` |
| 画面の骨格（サイドバー・パンくず） | `src/app/(app)/layout.tsx` / `src/components/layout/Sidebar.client.tsx` / `AppTopBar.client.tsx` |
| サイドバーの項目・画面名 | `src/components/layout/navItems.ts`（ナビ定義の正本。パンくずの画面名もここから引く） |
| ヘルプ・FAQ の文言 | `src/components/layout/helpContent.ts` |
| 認証ガード・セキュリティヘッダ | `src/proxy.ts`（ミドルウェア）/ `src/lib/security/securityHeaders.ts` |
| Supabase クライアント | ブラウザ `src/lib/supabase/client.ts` / サーバ（セッション引き継ぎ）`server.ts` / 管理用（service_role・サーバ専用）`admin.ts` |
| ログイン中ユーザーの情報 | クライアント `src/hooks/useCurrentUser.ts` / サーバ `src/lib/currentProfile.ts` |
| 会計年度・「最新データに更新」 | `src/contexts/FiscalYearContext.client.tsx` / `AppRefreshContext.client.tsx`（hook は `src/hooks/`） |
| 排出量の計算ロジック | 純関数 `src/features/calculation/engine/`（`computeEmissions` / `resolveEmissionFactor` / `units`）。DB を触る側は `calculation/services/` |
| 算定バッチ・再計算 API | `src/features/calculation/services/calculationService.ts` / `src/app/api/calculations/route.ts` |
| Server Action の戻り値の型 | `src/types/actionResult.ts` |
| 色・カード・ボタンの見た目 | 部品は `src/components/ui/`（shadcn/ui: R14）。色・角丸・影のトークンは `src/styles/globals.css` の `@theme`（生の hex は書かない: R5）。旧 `gt-*` クラスも同ファイル |
| DB スキーマ・RLS・RPC | `supabase/migrations/`（追加のみ: R9。DDL のみ: R12）。中身の説明は [`supabase/README.md`](supabase/README.md) |
| デモデータ・公式排出係数 | `supabase/seeds/demo/` / `supabase/seeds/production/`（生成元は `scripts/official-factors/`） |
| 単体テスト | 対象と同じディレクトリの `__tests__/`（R13）。UI テスト用ヘルパーは `src/lib/testing/render.tsx` |
| E2E スモーク | `e2e/smoke.spec.ts`（前提は [`docs/e2e-testing.md`](docs/e2e-testing.md)） |
| 環境変数 | `.env.example`（雛形。実値は `.env.local` に書き、コミットしない: R7） |
| 画面・URL・バリデーションの仕様 | [`docs/functional-spec.md`](docs/functional-spec.md) / 算定式は [`docs/calculation-logic.md`](docs/calculation-logic.md) |

---

## 4. 作業の進め方

1. **担当issueの範囲だけを変更する。** 「ついでに」他のページやライブララリ構成を変えない
2. ルーティングのURL・ディレクトリ名は [`docs/functional-spec.md`](docs/functional-spec.md) §4 の表と既存の `src/app/` の構成に従う（勝手に変えない）
3. 判断に迷ったら**独断で進めず**、issue / PR コメントに疑問点を書いて止める
4. コミット前に必ず確認:
   ```bash
   npm run lint              # ESLintが通ること
   npm run build             # 本番ビルドが通ること
   npm run test              # テストが通ること
   npm run typecheck         # 型検査が通ること（vitest も next build もテストファイルの型は見ない）
   npm run check:migrations  # マイグレーションを追加・変更した場合（DML が混入していないこと）
   ```
   *   **AIエージェントへの指示**: ユーザーにテストやマージを依頼する前に、必ずローカルで上記の検証コマンドを実行し、その結果（エラーがないこと）をチャット上に明示すること。
5. 開発サーバは `npm run dev` → **http://localhost:3000**（ポート固定。変更しない）

## 5. してはいけないことまとめ（チェックリスト）

- [ ] ライブラリを勝手に追加していないか
- [ ] `src/app/` にロジックを書きすぎていないか（featureに切り出したか）
- [ ] 新しい画面を `(app)` / `(auth)` のどちらかのルートグループに置いたか（ルート直下に `page.tsx` を作っていないか）。`(auth)` に足したなら `src/lib/security/authPaths.ts` も更新したか
- [ ] `'use client'` を必要な場所だけに付けたか。付けたコンポーネントは `<Name>.client.tsx` になっているか
- [ ] サイドバー等の出し分けを `usePathname()` で行っていないか（グループのレイアウトに任せる）
- [ ] 単体テストを対象と同じディレクトリの `__tests__/` に置いたか（実装の隣やルートの `tests/` に置いていないか）
- [ ] `SUPABASE_SERVICE_ROLE_KEY` をクライアント側に露出させていないか
- [ ] 別のルーター・ビルドツールの設定や import を持ち込んでいないか
- [ ] styled-componentsやCSS Modules等の別スタイル手法を持ち込んでいないか（TailwindとCSS変数の併用は許可）
- [ ] 共通 UI 部品を shadcn/ui（`src/components/ui/`）ではなく CSS クラスの新設で作っていないか
- [ ] 画面コンポーネントの `useState` が 8 個を超えていないか（超えるなら関心ごとごとに `hooks/` へ切り出したか。画面全体を 1 フックにまとめていないか）
- [ ] URLやポート番号を勝手に変えていないか
- [ ] 既存の SQL マイグレーションファイルを直接修正・削除していないか（新規ファイルで対応したか）
- [ ] マイグレーションにデータ（insert / update / delete 等）を入れていないか（seeds/production か seeds/demo に置いたか）
- [ ] デモ用データを seeds/production に混ぜていないか
- [ ] 明示的な指示なく既存のコードコメントや JSDoc を削除していないか
- [ ] CIテストやレビューのステータスを無視して強制マージを行おうとしていないか

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
