# supabase/

Supabase のマイグレーション（スキーマ）・シード（データ）・ローカル設定を置くディレクトリです。
**スキーマとデータは置き場所を分けています。** マイグレーションには DDL だけを書き、データは `seeds/` に置きます（`AGENTS.md` R12）。

## ディレクトリ構成

```
supabase/
├── config.toml                      # ローカル設定。[db.seed] sql_paths = ["./seeds/production/*.sql"]
├── migrations/                      # DDL のみ（データ禁止）。v1.0 初期スキーマの 4 本
│   ├── 20260831000000_schema.sql
│   ├── 20260831000001_rls.sql
│   ├── 20260831000002_rpc.sql
│   └── 20260831000003_storage.sql
├── seeds/
│   ├── production/
│   │   └── official_emission_factors.sql   # 公式排出係数マスタ（本番でも投入する）
│   └── demo/
│       └── demo.sql                        # デモ・テスト用データ（本番投入禁止）
└── README.md                        # このファイル
```

## セットアップ（ローカル開発）

```bash
npx supabase start                   # ローカル Supabase 起動（Docker 必須。Supabase CLI は npx で実行する）
npm run db:reset:demo                # DB を作り直し、スキーマ + 公式排出係数 + デモデータを投入
```

`config.toml` はコミット済みなので `supabase init` は不要です。手順の詳細は [`docs/setup-guide.md`](../docs/setup-guide.md)、スキーマ設計は `docs/database-design.md` を参照してください。

## migrations/ — スキーマ（DDL のみ）

この 4 本が OpenGreenTrack v1.0 の初期スキーマです。`supabase db reset` / `supabase db push` がタイムスタンプ順に適用します。後のファイルは前のファイルのテーブル・関数に依存するため、この順番が前提です。

| ファイル | 収録物 |
|---|---|
| `20260831000000_schema.sql` | extension（`pgcrypto`）/ enum 型 / テーブル / 制約 / インデックス / `comment on` / トリガー関数とトリガー（`set_updated_at`、重複チェックなど） |
| `20260831000001_rls.sql` | RLS 補助関数（`current_user_organization_id()` など）/ `enable row level security` / ポリシー / テーブルの GRANT・REVOKE / `alter default privileges` |
| `20260831000002_rpc.sql` | アプリが `supabase.rpc()` で呼ぶ関数（算定コミット・IDEA 取込・ダッシュボード/レポート読取・レート制限）と、各関数の GRANT / REVOKE EXECUTE |
| `20260831000003_storage.sql` | Storage バケットの定義（`insert` / `update`。マイグレーション内で唯一許容している DML）と `storage.objects` のポリシー |

> `rls.sql` §4.1 は 2 段構えです。既存テーブルへの `revoke all … from anon, authenticated`（Supabase の default privileges が自動付与した ALL を剥がす）と、`alter default privileges … revoke`（以後 `public` に作られるテーブル・シーケンス・関数を `anon` / `authenticated` へ自動公開しない）です。後者があるため、**テーブルを追加したときに §4.1 へ追記しなくても未公開のまま**です。逆に言えば、使わせたい権限は §4.2 / §4.3 の要領で `grant` を明示しない限りアプリからは見えません。関数だけは PUBLIC への `execute` が PostgreSQL 組み込みの既定で default privileges からは外せないため、`rpc.sql` と同じく **関数ごとに `revoke execute … from public, anon[, authenticated]` を書く**運用が引き続き必要です。

以後のスキーマ変更は、この 4 本を編集せず、新しいタイムスタンプ付きファイルを追加して行います（AGENTS.md R9）。

### ⚠️ 旧構成を適用済みの DB を持っている場合

この 4 本は、既存ファイル名（`20260831000000_schema.sql` 〜 `…_rpc.sql`）の中身を書き換え、後から積んでいたマイグレーションを削除する形でまとめ直したものです（v1.0 リリース前のため許容した措置。リリース後は R9 のとおり禁止）。そのため、**まとめ直す前の構成を適用済みの DB は、pull しただけでは最新スキーマになりません。**

- `supabase_migrations.schema_migrations` には削除済みバージョンの記録が残るため、`supabase db push` は「ローカルに無いバージョンが remote にある」というエラーで止まります。
- `npx supabase migration repair --status reverted <version>` でその記録を消してもまだ不十分です。中身を書き換えた 3 本（`…_schema.sql` / `…_rls.sql` / `…_rpc.sql`）は **バージョン記録が残っている＝適用済み** と判定されて実行されないため、エラーも出ないまま古いスキーマのまま残ります（サイレントスキップ）。
- かといって、書き換えた 3 本のバージョンまで `--status reverted` にして再実行させることはできません。3 本は素の `create table` / `create policy` / `create function` で書かれており（`if not exists` / `or replace` / 事前の `drop` を付けていません）、旧構成で作られたオブジェクトが残っている DB では最初の `already exists` で push が止まります。履歴だけ reverted に書き換えた後に止まるため、実行前より状態が悪くなります（戻すには同じバージョンを `--status applied` で repair し直す）。

対処:

| 環境 | 手順 |
|---|---|
| ローカル | `npx supabase db reset`（= `npm run db:reset`。デモデータも入れるなら `npm run db:reset:demo`）で作り直す。**pull 後は必ず実行する** |
| `db push` で運用しているクラウド（検証用） | DB をリセットして `npx supabase db push --include-seed` で入れ直す。これが唯一の確実な手順 |
| 上記のうち、DB を作り直せない場合 | ① 削除済みバージョンを `npx supabase migration repair --status reverted <version>` で履歴から消す（これをしないと push 自体が止まる）。② 現在の 4 本と DB の実態との差分を、Supabase ダッシュボードの SQL Editor から**手で適用する**（差分の把握には `npx supabase db diff --linked` が使える。ただし出力は remote 側を基準にした SQL で向きが逆になり得るため、そのまま流さず読み替える）。③ `…_storage.sql` のバージョンが remote 履歴に無ければ、次の push でそれだけが新規適用される。**書き換えた 3 本のバージョンは applied のまま触らない**（上記のとおり再実行はできない）。差分の内容は DB を最後に更新した時点で決まり、3 本はリリースまで編集され続けているため、「旧構成を全部適用済みなら差分は無い」とは限らない |

マイグレーションに **データを書くことは禁止** です。`insert` / `update` / `delete` / `copy` / `truncate` / `merge` は、排出係数マスタでも、組織・ユーザーでも、既存行の訂正（バックフィル）でも `migrations/` には置かず、`seeds/` に置きます（例外は `storage.buckets` への `insert` / `update`（バケットの定義と設定変更）だけ。バケットはインフラ設定であり、Supabase 公式の作成手段が SQL のためです。`20260831000003_storage.sql` がこの例外に当たります）。`npm run check:migrations` が機械的に検出します。

## seeds/ — データ

| ディレクトリ | 内容 | 本番 | いつ流れるか |
|---|---|---|---|
| `seeds/production/` | 公式排出係数マスタ（`emission_factors` の `organizationId is null` 行）。`scripts/official-factors/generate.ts` が生成する | **投入する** | `supabase db reset` と `supabase db push --include-seed` で自動的に流れる（`config.toml` の `[db.seed] sql_paths`）。単独で流すなら `npm run db:seed:production` |
| `seeds/demo/` | 架空のデモ組織 2 社（架空精密工業株式会社 / 架空ロジスティクス株式会社）、デモユーザー（`org-a@example.com` / `password123` など）、拠点、2023〜2026 年度の月次活動量と算定結果、Scope3、算定検証用データ | **投入しない** | 自動では流れない。`npm run db:reset:demo` または `npm run db:seed:demo` で明示的に入れたときだけ |

- シードはすべて **冪等**（`on conflict … do nothing / do update`、または削除→再投入）です。何度流しても同じ結果になります。
- `production` と `demo` は互いに依存しません。どちらか一方だけでも流せます。
- デモのログイン情報（`org-a@example.com` / `password123`）が使えるのは、**デモシードを入れたときだけ** です。`supabase db reset` だけでは組織もユーザーも作られないため、その場合はアプリの初期セットアップ画面（`/signup`）から組織と管理者を作ります。

## コマンド一覧

Supabase CLI は `npx supabase …` で実行します（devDependency には追加していません。`npm run db:*` も `npx supabase` を呼びます。Homebrew 等で入れた `supabase` を併用する場合は、ローカルスタックを起動した CLI と `db reset` を実行する CLI の版がずれると壊れやすいため、同じメジャーバージョンに揃えてください）。`npm run …` は `package.json` に定義したコマンドの短縮形です。稼働中の DB へシードを流す `db:seed:*` は `scripts/db/seed.ts` が担当し、ローカル Supabase の DB コンテナ内で `psql -v ON_ERROR_STOP=1` を実行します（`--db-url` 指定時はホストの `psql` を使います）。

| 目的 | コマンド | 備考 |
|---|---|---|
| ローカル DB を作り直す（スキーマ + 公式排出係数） | `npx supabase db reset`（= `npm run db:reset`） | `config.toml` の `[db.seed].sql_paths` = `seeds/production/*.sql` |
| ローカル DB を作り直す + デモデータ | `npm run db:reset:demo`（= `npx supabase db reset --sql-paths "./seeds/production/*.sql" --sql-paths "./seeds/demo/*.sql"`） | `--sql-paths` は `supabase/` からの相対パス |
| 稼働中のローカル DB にデモデータを入れる | `npm run db:seed:demo`（= `node scripts/db/seed.ts demo`） | ローカル Supabase が起動していること |
| 稼働中のローカル DB に公式排出係数を（再）投入する | `npm run db:seed:production`（= `node scripts/db/seed.ts production`） | 係数の訂正・年度更新を反映するとき |
| 任意の DB（クラウド / 自前ホスト）に公式排出係数を投入する | `npm run db:seed:production -- --db-url postgresql://…` | ホストの `psql` を使う。無ければ Dashboard の SQL Editor でファイルの内容を実行する |
| クラウド: スキーマのみ反映 | `npx supabase db push` | `supabase link` 済みのプロジェクトへ |
| クラウド: スキーマ + 公式排出係数 | `npx supabase db push --include-seed` | `sql_paths`（production）だけが流れる。初回はこちらを推奨 |
| クラウド: デモデータ | Dashboard の SQL Editor で `seeds/demo/demo.sql` を実行、または `npm run db:seed:demo -- --db-url postgresql://… --force` | **本番プロジェクトでは行わない**（検証用プロジェクトのみ。誤投入防止のため、`--db-url` 指定時は `--force` が無いと拒否される） |
| シード無しで作り直す | `npx supabase db reset --no-seed` | スキーマだけ確認したいとき |

## ルール（`AGENTS.md`）

- **R9 マイグレーションの不変性**: `migrations/` の既存ファイルは編集・削除しない。スキーマ変更は新しいタイムスタンプ付きファイルを追加する（変更は追加のみ）。v1.0 初期スキーマの 4 本と後から追加したファイルを 1 本にまとめ直すこともしない（squash は v1.0 リリース前に限る。リリース後は適用済み DB の `supabase_migrations.schema_migrations` と食い違い `db push` が壊れる）。
- **R12 マイグレーションにデータを入れない（DDL 専用）**: データは `seeds/production/`（本番でも投入する共通マスタ）または `seeds/demo/`（テスト・デモ用）へ。既存データの訂正も seed を直して再投入する（migration で `update` しない）。
- 機械チェック: `npm run check:migrations`（CI と lefthook の pre-commit で自動実行）。

## 新しいマイグレーションを追加する

```bash
npx supabase migration new add_xxx_column   # migrations/<timestamp>_add_xxx_column.sql が作られる
```

1. 作られたファイルに **DDL だけ** を書く（テーブル・列・制約・インデックス・関数・トリガー・ポリシー・GRANT・`comment on`）。書式は既存ファイルに合わせる（小文字キーワード、2 スペースインデント、camelCase 識別子はダブルクォート）。コメントは SQL を読んでも分からないこと（セキュリティ上の前提・意図・運用上の落とし穴）だけを短く書き、SQL の言い換えや経緯は書かない。
   - **新しいテーブル・ビュー・RPC には必ず明示的に GRANT / REVOKE を書く。** `config.toml` は `[api] auto_expose_new_tables` を未設定（= 新しいエンティティを `anon` / `authenticated` / `service_role` に自動公開しない。クラウドの新既定と同じ）にしている。自動付与の有無は CLI / クラウドの版で変わり、ローカルで動いても本番で権限不足になり得るため、どちらの前提でも成り立つように明示的に書く。テーブルは `revoke all … from anon, authenticated` → 必要な権限だけ `grant`（`20260831000001_rls.sql` §4.1 / §4.3 参照）、関数は `revoke execute … from public, anon[, authenticated]` → `grant execute`（`20260831000002_rpc.sql` 参照）を対にして書く。`create or replace function` は既存の EXECUTE 権限を保つが `drop` → `create` は PUBLIC 公開に戻るので、作り直すときも同じ対を再適用する。なお `invites` の列指定 INSERT GRANT は、自動付与が無い環境では `authenticated` が `invites` に INSERT できる唯一の根拠であり、実際の制限として機能している（`token` / `expiresAt` / `acceptedAt` は列 default、`invitedByUserId` はトリガーに任せる）。
2. 既存ファイル（初期スキーマの 4 本を含む）は編集しない（R9）。列の追加も削除も、必ず新しいファイルで行う。
3. 新しい列に既存行の値を入れたい・マスタの値を直したい場合は、migration に `update` を書かず、seed 側を直して再投入する（R12）。
4. `npm run check:migrations` と `npx supabase db reset` で確認してからコミットする。

## 公式排出係数を更新・訂正する

`seeds/production/official_emission_factors.sql` は手で編集しません。`scripts/official-factors/data/` の元データを直し、`generate.ts` で再生成します（データソース・年度更新の手順は [`scripts/official-factors/README.md`](../scripts/official-factors/README.md)）。

```bash
node scripts/official-factors/generate.ts   # seeds/production/official_emission_factors.sql を上書き生成
npm run db:seed:production                  # 稼働中のローカル DB に再投入（npx supabase db reset でも可）
```

生成される seed は `on conflict (id) do update` の冪等 upsert です。値・出典・名称の訂正は「再生成して再投入」で反映されます（`status` は上書きしないため、アーカイブ済みの行が戻ることはありません。変更のない行は更新されません）。行の ID は名称を含まない安定キーから導出しているので、名称の訂正でも行が増えることはありません（詳細は `scripts/official-factors/README.md`「行の ID（安定キー）」）。

> `.env` やアクセスキーをこのディレクトリにコミットしないこと（`AGENTS.md` R7 参照）。
