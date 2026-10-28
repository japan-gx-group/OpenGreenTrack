-- SSBJ 開示レポート（R2）: SSBJ のロールのテーブルを、PostgREST が profiles と organizations の多対多の中間テーブルとみなさないようにする
-- （20261020100000_ssbj_member_roles.sql の主キーを付け替える。docs/database-design.md 3.29）。
--
-- ssbj_member_roles は主キー（"organizationId", "userId"）の 2 列がそれぞれ organizations と profiles への外部キーなので、
-- PostgREST は profiles ↔ organizations の多対多の関係として扱っていた。そのため OGT 本体の画面が使う
-- profiles から organizations への埋め込み（select=…,organizations(name)。src/contexts/CurrentUserContext.client.tsx）が
-- 「関係が 2 つある」（PGRST201）で失敗し、ログイン中の利用者の情報が取れなくなっていた
-- （サイドバーの組織名が出ない、データ入力の後の自動の算定がスキップされる、画面の管理者の判定が効かない）。
-- PostgREST は、外部キーの列が主キーに含まれる表だけを中間テーブルとみなすので、主キーを新しい列 id に替え、
-- 組織×利用者で 1 行であることは一意の制約で守る。外部キー・連鎖削除・RLS・判定の関数・操作履歴のトリガーは変えない。
-- id の既定値（gen_random_uuid()）は、列を足すときに既存の行にも入る（データの更新文は書かない）。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用）

alter table ssbj_member_roles drop constraint ssbj_member_roles_pkey;

alter table ssbj_member_roles add column id uuid not null default gen_random_uuid();

alter table ssbj_member_roles add constraint ssbj_member_roles_pkey primary key (id);

alter table ssbj_member_roles
  add constraint ssbj_member_roles_organization_user_key unique ("organizationId", "userId");

comment on column ssbj_member_roles.id is
  '行の ID（主キー）。組織×利用者で 1 行であることは ssbj_member_roles_organization_user_key が守る。'
  '組織・利用者の列を主キーにしないのは、PostgREST が profiles ↔ organizations の中間テーブルとみなし、本体の埋め込みを壊すため。';
