-- 組織の設定（企業情報・招待）を管理者だけにする: current_user_is_admin() を「role が admin か」に差し替える
--
-- 20260831000001_rls.sql の current_user_is_admin() は、ロール別の権限を入れるまで「ログインしているか」だけを返していた
-- （同ファイルの注記「導入時は本体を profiles.role 参照に差し替えるだけでよい」）。ロールの変更と最後の管理者の保護
-- （20261024090000_member_roles.sql）が入ったので本体を差し替え、次のポリシーを書き換えずに管理者だけにする。
--   organizations_update_own（企業情報の編集）
--   invites_select_own_organization_admin / invites_insert_own_organization_admin / invites_delete_own_organization_admin（招待）
--
-- 算定年度（fiscal_years）の追加・削除は service_role の Server Action なので、管理者の確認は Server Action 側で行う。
-- current_user_can_edit() は「ログインしているか」のまま（データの入力・算定・マスタの編集はロールにかかわらず全員が行う）。
-- invites.role の列 GRANT は変えない（招待を作れるのは上のポリシーで管理者に限られる）。
-- create or replace は関数の所有者と EXECUTE の権限をそのまま残す（authenticated だけが実行できる）。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用）

create or replace function current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
$$;

comment on function current_user_is_admin() is
  'ログイン中の利用者が管理者（profiles.role = ''admin''）か。組織の範囲は各ポリシーの organizationId 条件で担保する。';

comment on function current_user_can_edit() is
  'ロールにかかわらず「認証済みか」を返す（データの入力・算定・マスタの編集は全員が行う）。ポリシーからは参照していない。';
