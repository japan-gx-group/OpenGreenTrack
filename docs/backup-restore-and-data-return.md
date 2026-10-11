# バックアップからの復元と、組織のデータの返却・削除の手順

実際の企業のデータを預かる前に、次の 2 つに答えられるようにするための手順書。

- 障害が起きたとき、どこまで、どれくらいの時間で戻せるか
- 利用が終わったとき、組織のデータをどう返して、どう消すか

アプリの中の「版の復元」（SSBJ の保存版に戻す機能）とは別の話で、DB とファイルの運用の手順になる。
ここに書いた手順は、ローカルのデモデータ（架空）で演習した（§8）。実際の企業のデータではまだ行っていない。

関連: バックアップの取り方・プランごとの機能・行だけを戻す部分復旧は [`setup-guide.md`](setup-guide.md) の「2-G. バックアップとリストア」。

## 1. 用語と、答え（演習の結果から）

| 問い | 答え |
|---|---|
| どこまで戻せるか（失うデータの範囲） | 最後に取ったバックアップの時点まで。自前のバックアップを毎日取るなら、最大で 1 日分を失う。クラウドのプランの PITR を使えば、分単位の時点まで戻せる（[`setup-guide.md`](setup-guide.md) G-1。使うプランはチームで決める。§9） |
| どれくらいの時間で戻せるか | ローカルのデモデータ（3 組織・約 2,200 KB のバックアップ）で、DB の作り直し 26 秒、データの流し込み 1 秒未満、確認 1 分ほど（§8）。データの量に比例して延びる |
| 返す形 | テーブルごとの JSON Lines と、件数・SHA-256 を書いた `manifest.json`（§6） |
| 消す範囲 | その組織に属するすべてのテーブルの行と、その組織のユーザー。ほかの組織の行が変わらないことを、確定の前に確かめる（§7） |

## 2. 対象のデータ

| 種類 | 場所 | 返却 | 削除 |
|---|---|---|---|
| 組織に属するテーブル（OGT 本体 19・SSBJ 9） | `scripts/ops/orgDataTables.ts` の一覧 | 書き出す | 消す |
| 組織のユーザー | `auth.users`（`profiles` がその組織を指すユーザー） | 書き出さない（名前・メールアドレス・ロールは `profiles` で返す） | 消す |
| Storage のファイル | `upload-quarantine`（IDEA 取込の一時ファイル。取込の後に消える）・`import-files`。パスの先頭のフォルダが組織 ID | ファイルの一覧だけを書き出す | 先に手で消す（§7） |
| 全組織で共通のデータ | 公式の排出係数など（`organizationId` が null の行） | 対象外 | 対象外 |

- テーブルを足したら、`scripts/ops/orgDataTables.ts` に足す。足し忘れは `scripts/ops/__tests__/orgDataTables.test.ts` が検出する。
- 書き出さない列: `organizations.apiKeyHash`（API キーのハッシュ）、`invites.token`（招待を受けるための値）。どちらも認証に使う値で、返す必要が無い。

## 3. 準備

- スクリプト: `node scripts/ops/org-data.ts <summary|export|delete> --org <組織ID>`（使い方は `--help`）
- **接続先**: 既定はローカル Supabase の DB コンテナ（`supabase/config.toml` の `project_id` から決まる）。
  クラウドなどの DB には `--db-url` で接続し、ホストに `psql` が要る。接続文字列は環境変数に入れて渡し、コマンドの履歴や手順書に残さない。

  ```bash
  read -s OGT_DB_URL   # 接続文字列を貼り付ける（画面に出ない）
  export OGT_DB_URL
  node scripts/ops/org-data.ts summary --org <組織ID> --db-url "$OGT_DB_URL"
  ```

- **`service_role` キーは使わない。** スクリプトは DB に直接接続し、RLS の対象外で読む・消す。
- **置き場所**: バックアップ・書き出し・削除の記録は、リポジトリの外に置き、見られる人を限る。
  スクリプトは、リポジトリの中への書き出しと記録を拒否する（組織のデータをコミットしてしまわないため）。
- 組織 ID は `summary` の 1 行目か、OGT の管理画面で確かめる。

## 4. バックアップ

### 4.1 クラウドの機能

プランごとの自動バックアップ・PITR は [`setup-guide.md`](setup-guide.md) G-1 のとおり。どのプランを使うかは §9 で決める。

### 4.2 自前のバックアップ（データだけ）

スキーマ（テーブルや関数の定義）はリポジトリのマイグレーションから作れるため、データだけを取る。

```bash
# ローカル
npx supabase db dump --local --data-only --use-copy -f <リポジトリの外>/ogt-data-YYYYMMDD.sql
# クラウド（supabase link 済みのプロジェクト）
npx supabase db dump --linked --data-only --use-copy -f <リポジトリの外>/ogt-data-YYYYMMDD.sql
```

- `public`（OGT 本体と SSBJ）・`auth`（ログインの情報）・`storage`（ファイルの一覧。中身は含まない）のデータが入る。
- バックアップには全組織のデータとログインの情報が入る。`.env.local` と同じく厳重に扱う。
- 取ったときに、主な組織の `summary` を残しておくと、復元の確認に使える。

  ```bash
  node scripts/ops/org-data.ts summary --org <組織ID> --json > <リポジトリの外>/summary-<組織ID>-YYYYMMDD.json
  ```

## 5. 復元（DB 全体）

ローカルの手順（§8 で演習した手順）。クラウドの DB 全体を戻すときは、Dashboard の機能を使う（[`setup-guide.md`](setup-guide.md) G-1・G-3）。
消してしまった一部の行だけを戻すときは、[`setup-guide.md`](setup-guide.md) G-3 の部分復旧を使う。

1. **空の DB を作る**（⚠️ ローカルの DB のデータはすべて消える）

   ```bash
   npx supabase db reset --local --no-seed
   ```

   マイグレーションでスキーマを作り、データは入れない（公式の排出係数もバックアップから戻す）。

2. **バックアップのデータを流す**

   ```bash
   docker exec -i supabase_db_<project_id> psql -U supabase_admin -d postgres -X -q -v ON_ERROR_STOP=1 --single-transaction \
     -c 'set session_replication_role = replica' -c 'delete from storage.buckets' \
     -f - < <リポジトリの外>/ogt-data-YYYYMMDD.sql
   ```

   - `supabase_admin` で流す。`postgres` では Storage の内部のテーブルに書けず、`permission denied for table buckets_vectors` で止まる。
   - `session_replication_role = replica` で、トリガーと外部キーの確認を止める。止めないと、承認済みのレポートの行が承認ロックで止まる、
     操作履歴が二重に増える、作成者・版数が書き換わる、などが起きる（バックアップの値をそのまま戻すため）。
   - `storage.buckets` はマイグレーションが作る行と重なるため、先に消してからバックアップの行を入れる。
   - 1 つのトランザクションで流すため、途中で止まったら何も入らない。

3. **確かめる**

   ```bash
   node scripts/ops/org-data.ts summary --org <組織ID> --json > <リポジトリの外>/summary-<組織ID>-restored.json
   diff <リポジトリの外>/summary-<組織ID>-YYYYMMDD.json <リポジトリの外>/summary-<組織ID>-restored.json
   ```

   - 差が無ければ、テーブルごとの件数とチェックサム（全列の値から作る）が、バックアップを取ったときと同じ。保存版・操作履歴・根拠文書の記録もここに含まれる。
   - 画面でログインし、SSBJ の保存履歴・操作履歴・根拠文書が見えることを確かめる。

## 6. 組織のデータの返却（書き出し）

```bash
node scripts/ops/org-data.ts summary --org <組織ID>
node scripts/ops/org-data.ts export --org <組織ID> --out <リポジトリの外の、まだ無いか空のディレクトリ>
```

- 書き出すもの: テーブルごとの `<テーブル名>.jsonl`（1 行 1 件の JSON。列名は DB と同じ）、`storage.objects.jsonl`（Storage にあるファイルの一覧）、
  `manifest.json`（組織・書き出した日時・テーブルごとの件数・ファイルの SHA-256・書き出さない列）。
- 件数の照合: 1 つのトランザクション（読むだけ）で読み、テーブルごとに「書き出した行数」と「同じ時点の DB 上の件数」を比べる。
  一致しなければ、ファイルを書かずに止まる。`manifest.json` の件数は `summary` の件数とも一致する。
- Storage のファイルの中身は含まない。要るときは Dashboard の Storage からダウンロードする。
- 渡し方（暗号化・受け渡しの方法）は §9 で決める。渡した後、書き出したファイルは手元から消す。

## 7. 組織のデータの削除

1. 返却が済んでいることを確かめる（相手が受け取った `manifest.json` の件数と SHA-256 を、手元のものと照らし合わせる）。
2. **Storage のファイルを消す。** Dashboard（ローカルは Studio）の Storage で、`upload-quarantine` と `import-files` の `<組織ID>` フォルダを消す。
   スクリプトは、この組織のファイルが Storage に残っていると何も消さずに止まる（SQL で消すと、ファイルの実体が残るため）。
3. **試行する**（何も消さない）

   ```bash
   node scripts/ops/org-data.ts delete --org <組織ID>
   ```

   テーブルごとの「削除される件数」と「ほかの組織の件数」が出る。実際に消して確かめてから元に戻すため、消せない理由があればここで分かる。

4. **実行する**

   ```bash
   node scripts/ops/org-data.ts delete --org <組織ID> --execute \
     --confirm-name "<DB の組織名>" --record <リポジトリの外>/deletion-<組織ID>.json
   ```

   - `--confirm-name` が DB の組織名と違えば、何も始めない（組織 ID の取り違え防止）。
   - 1 つのトランザクションで、`system_audit_logs`（組織への外部キーが on delete restrict のため先に消す）→ 組織のユーザー → 組織（ほかのテーブルは連鎖削除）の順に消す。
   - 確定の前に「この組織の行が 0 件」「ほかの組織の行の件数とチェックサムが変わっていない（`auth.users` は件数だけ）」を確かめ、満たさなければ何も消さずに止まる。
   - 削除の記録（組織・日時・接続先・実行した人・テーブルごとの件数・確かめたこと）を `--record` のファイルに残す。保管場所は §9 で決める。

5. **確かめる**: `summary --org <組織ID>` が「組織が見つかりません」で終わる。ほかの組織の `summary` が削除の前と同じ。

止まったときは:

| メッセージ | 理由と対応 |
|---|---|
| Storage にこの組織のファイルが残っています | 手順 2 を行う |
| ほかの組織の行が変わりました: <テーブル> | ほかの組織の行が、この組織の行を指している（連鎖削除や null の設定でほかの組織の行が変わる）。どの行かを調べ、扱いを決めてからやり直す |
| --confirm-name が組織名と一致しません | 組織 ID と組織名を確かめ直す |

注意:

- **削除の前に取ったバックアップには、この組織のデータが残る。** バックアップの保持期間を過ぎて消えるまで残ることを、削除の記録と相手への説明に含める（§9）。
- OGT 本体の操作履歴（`system_audit_logs`）も一緒に消える。削除したことは、削除の記録のファイルで残す。

## 8. 演習の記録

| 項目 | 内容 |
|---|---|
| 日時 | 2026-10-11 |
| 環境 | ローカル Supabase（Supabase CLI 2.117.0・PostgreSQL 17.6）。`ssbj` の 6b9dfa1 のマイグレーションと、デモデータ（`npm run db:seed:demo` と同じ `scripts/db/seed.ts demo`） |
| データ | 3 組織。組織 A（架空精密工業株式会社）: 活動量 780 件・算定結果 780 件・SSBJ レポート 1 件（承認済み・保存版 2 件・操作履歴 22 件）など。組織 B（架空ロジスティクス株式会社） |
| 実施者 | 木原（Claude Code と実施） |

| # | 手順 | かかった時間 | 結果 |
|---|---|---|---|
| 1 | 組織 A・B の `summary`（バックアップ前） | 1 秒未満 | 記録した |
| 2 | バックアップ（`supabase db dump --local --data-only --use-copy`） | 1 秒 | 約 2,200 KB |
| 3 | 障害の代わりに DB を作り直す（`supabase db reset --local --no-seed`） | 26 秒 | 組織 0 件 |
| 4 | 復元（§5 の 2） | 1 秒未満 | 1 回目は `postgres` で流して `permission denied for table buckets_vectors` で止まった（何も入らず）。`supabase_admin` で流し直して通過 |
| 5 | 復元の確認（`summary` を比べる・ログイン） | 1 分ほど | 組織 A・B とも全テーブルの件数とチェックサムが一致。`org-a@example.com` でログインできた |
| 6 | 組織 A の書き出し | 1 秒未満 | 29 ファイルと `manifest.json`。件数は書き出した行数・`summary` と一致。`apiKeyHash`・`token` は含まない。リポジトリの中への書き出しは拒否された |
| 7 | 組織 A のファイルを Storage に置いて削除を試行 | 1 秒未満 | 「Storage にこの組織のファイルが残っています」で止まった。Storage から消して先へ進んだ |
| 8 | 削除の試行 | 1 秒未満 | 削除される件数が出て、組織 A は残っていた |
| 9 | 違う組織名で削除を実行 | 1 秒未満 | 何も始めずに止まった |
| 10 | 削除の実行 | 1 秒未満 | 組織 A の行が 0 件。組織 B の `summary` は削除の前と一致。削除の記録ができた |
| 11 | 復元し直し、組織 B の活動量 1 件が組織 A の排出係数を指す形にして削除を試行 | 1 秒未満 | 「ほかの組織の行が変わりました: activity_records」で止まった（何も消えていない） |

見つかった問題と対応:

- `postgres` では Storage の内部のテーブルに書けず、復元が止まる → `supabase_admin` で流す手順にした（ローカル）。クラウドの DB へ自前のバックアップを流す手順は、まだ演習していない。
- `storage.buckets` の行がマイグレーションの作る行と重なる → 流す前に消す手順にした。
- [`setup-guide.md`](setup-guide.md) G-1 の「Supabase Storage を使わない」は、今の実装（IDEA 取込の一時ファイルを Storage に置く）と違う。別の作業で直す。
- 演習は、既定のポートで動いている別のローカル Supabase を止めないよう、`project_id` とポートを変えた作業ディレクトリ（`supabase start --workdir`）で行った。手順はポートに依らない。

## 9. 決めること（チームの合意が必要）

1. **クラウドのプランと PITR**: どこまで戻せるか（失ってよいデータの範囲）を決め、それに合うプランにする。
2. **自前のバックアップの頻度・保持期間・保管場所**: [`setup-guide.md`](setup-guide.md) G-2 の目安（毎日・30 日以上）でよいか。
3. **削除した組織のデータがバックアップに残る期間の扱い**: 相手への説明と、削除の記録への書き方。
4. **書き出したデータの渡し方**: 暗号化の方法、受け渡しの経路、相手の確認の仕方。
5. **削除の記録の保管場所**: 公開リポジトリには置かない（組織名を含むため）。
6. **返す形**: JSON Lines だけでよいか、CSV なども要るか。
