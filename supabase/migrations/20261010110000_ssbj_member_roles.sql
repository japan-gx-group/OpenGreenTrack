-- SSBJ 開示レポート（R2）: SSBJ のロール（入力担当・承認担当・閲覧者）と、ロールを判定する関数
-- （docs/authorization-matrix.md §1・§2.4・§5）。
--
-- OGT 本体はロールで権限を分けない方針（src/types/role.ts の「ロール無効化中」）で、R2 では本体の権限の仕組みを変えない。
-- そこで、SSBJ の中だけで使うロールを SSBJ 専用のテーブルに持つ。本体の profiles.role は 'admin' だけを読む
-- （OGT の管理者は SSBJ でもすべての操作ができる）。current_user_can_edit() / current_user_is_admin()、
-- profiles / invites の制約、招待画面は変えない。
--
-- ロールを割り当てていない利用者は入力担当として扱う。今は同じ組織の利用者なら誰でもすべてを編集できるので、
-- 有効にしたときに既存の利用者を締め出さないため（§5）。各テーブル・API への適用は後続の変更で行う。

-- §1 テーブル（組織×利用者で 1 行。行が無い利用者は入力担当）

create table ssbj_member_roles (
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "userId" uuid not null references profiles(id) on delete cascade,
  -- editor（入力担当）/ approver（承認担当）/ viewer（閲覧者）。管理者は profiles.role で決まり、ここには持たない。
  role varchar(20) not null,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  primary key ("organizationId", "userId"),
  constraint ssbj_member_roles_role_check check (role in ('editor', 'approver', 'viewer'))
);

comment on table ssbj_member_roles is
  'SSBJ のロールの割り当て（組織×利用者）。行が無い利用者は入力担当。OGT の管理者（profiles.role = ''admin''）は割り当てに関係なく管理者。'
  'docs/authorization-matrix.md §1。';
comment on column ssbj_member_roles.role is 'editor（入力担当）/ approver（承認担当）/ viewer（閲覧者）。';

create trigger set_ssbj_member_roles_actor
before insert or update on ssbj_member_roles
for each row execute function set_row_actor();

create trigger set_ssbj_member_roles_updated_at
before update on ssbj_member_roles
for each row execute function set_updated_at();

-- §2 ロールを判定する関数
-- ssbj_user_role: 'admin' / 'editor' / 'approver' / 'viewer'。組織の利用者でなければ null。
-- 利用者と組織を引数で受け取るため service_role 限定（状態の変更の RPC などが使う）。
-- 画面・RLS はログイン中の利用者の関数（ssbj_current_user_*）を使う。

create function ssbj_user_role(p_user_id uuid, p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.role = 'admin' then 'admin' else coalesce(m.role, 'editor') end
  from public.profiles p
  left join public.ssbj_member_roles m
    on m."organizationId" = p."organizationId" and m."userId" = p.id
  where p.id = p_user_id
    and p."organizationId" = p_organization_id;
$$;

comment on function ssbj_user_role(uuid, uuid) is
  'SSBJ のロール（admin / editor / approver / viewer）。組織の利用者でなければ null。割り当てが無ければ editor。service_role 限定。';

revoke execute on function ssbj_user_role(uuid, uuid) from public, anon, authenticated;
grant execute on function ssbj_user_role(uuid, uuid) to service_role;

-- 承認者に指定でき、承認・差戻しができるロールか（承認担当か管理者）。service_role 限定。
create function ssbj_user_can_approve(p_user_id uuid, p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.ssbj_user_role(p_user_id, p_organization_id) in ('admin', 'approver'), false);
$$;

comment on function ssbj_user_can_approve(uuid, uuid) is
  'SSBJ で承認者に指定でき、承認・差戻しができるロール（承認担当か管理者）か。service_role 限定。';

revoke execute on function ssbj_user_can_approve(uuid, uuid) from public, anon, authenticated;
grant execute on function ssbj_user_can_approve(uuid, uuid) to service_role;

-- ログイン中の利用者のロール（RLS のポリシーと画面の出し分けに使う）。

create function ssbj_current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.ssbj_user_role(auth.uid(), public.current_user_organization_id());
$$;

comment on function ssbj_current_user_role() is 'ログイン中の利用者の SSBJ のロール（admin / editor / approver / viewer）。';

-- 作業中データを編集できるか（入力担当か管理者）。
create function ssbj_current_user_can_edit()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.ssbj_current_user_role() in ('admin', 'editor'), false);
$$;

comment on function ssbj_current_user_can_edit() is 'ログイン中の利用者が SSBJ の作業中データを編集できるか（入力担当か管理者）。';

-- 作業中データ・保存版・操作履歴を見られるか（閲覧者以外）。閲覧者は承認した保存版だけを見る。
create function ssbj_current_user_can_view_working()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.ssbj_current_user_role() in ('admin', 'editor', 'approver'), false);
$$;

comment on function ssbj_current_user_can_view_working() is
  'ログイン中の利用者が SSBJ の作業中データ・保存版・操作履歴を見られるか（閲覧者以外）。';

-- SSBJ の管理者か（OGT の管理者）。ロールの割り当てができる。
create function ssbj_current_user_is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(public.ssbj_current_user_role() = 'admin', false);
$$;

comment on function ssbj_current_user_is_admin() is 'ログイン中の利用者が SSBJ の管理者（OGT の管理者）か。SSBJ のロールを割り当てられる。';

revoke execute on function ssbj_current_user_role() from public, anon;
revoke execute on function ssbj_current_user_can_edit() from public, anon;
revoke execute on function ssbj_current_user_can_view_working() from public, anon;
revoke execute on function ssbj_current_user_is_admin() from public, anon;
grant execute on function ssbj_current_user_role() to authenticated;
grant execute on function ssbj_current_user_can_edit() to authenticated;
grant execute on function ssbj_current_user_can_view_working() to authenticated;
grant execute on function ssbj_current_user_is_admin() to authenticated;

-- §3 RLS と権限（見るのは自組織の全員。割り当て・変更・解除は管理者だけ）
-- 一覧を全員に見せるのは、承認者の候補（承認担当か管理者）を画面に出すため。
-- 割り当てる利用者は同じ組織の人に限る。

alter table ssbj_member_roles enable row level security;

create policy "ssbj_member_roles_select_own_organization"
on ssbj_member_roles
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_member_roles_insert_admin"
on ssbj_member_roles
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and (select ssbj_current_user_is_admin())
  and exists (
    select 1 from profiles p
    where p.id = "userId"
      and p."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_member_roles_update_admin"
on ssbj_member_roles
for update
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and (select ssbj_current_user_is_admin())
)
with check (
  "organizationId" = (select current_user_organization_id())
  and (select ssbj_current_user_is_admin())
);

create policy "ssbj_member_roles_delete_admin"
on ssbj_member_roles
for delete
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and (select ssbj_current_user_is_admin())
);

grant select, delete on ssbj_member_roles to authenticated;
grant insert ("organizationId", "userId", role) on ssbj_member_roles to authenticated;
grant update (role) on ssbj_member_roles to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。

-- §4 割り当ての変更を操作履歴に残す
-- ロールはレポートに属さないので、操作履歴（ssbj_audit_logs）の reportId を空にできるようにする。
-- 空にできるのはロールの記録（targetType = 'member_role'）だけ。レポートの画面の履歴には出ない。

alter table ssbj_audit_logs
  alter column "reportId" drop not null,
  add constraint ssbj_audit_logs_report_required check ("reportId" is not null or "targetType" = 'member_role');

comment on column ssbj_audit_logs."reportId" is
  '対象のレポート。SSBJ のロールの割り当ての記録（targetType = member_role）だけは空（レポートに属さないため）。';

create function ssbj_audit_member_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ssbj_member_roles%rowtype;
  v_action text;
  v_details jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'delete';
    v_details := jsonb_build_object('previousRole', old.role);
  elsif tg_op = 'INSERT' then
    v_row := new;
    v_action := 'create';
    v_details := jsonb_build_object('role', new.role);
  else
    if new.role is not distinct from old.role then
      return null;
    end if;
    v_row := new;
    v_action := 'update';
    v_details := jsonb_build_object('role', new.role, 'previousRole', old.role);
  end if;

  -- 組織の削除に伴う連鎖削除では記録しない（記録先の外部キーが消える組織を指すため。デモデータの入れ直しを止めない）。
  if not exists (select 1 from public.organizations o where o.id = v_row."organizationId") then
    return null;
  end if;

  insert into public.ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", details)
  values
    (v_row."organizationId", null, coalesce(auth.uid(), v_row."updatedByUserId"), v_action, 'member_role',
     v_row."userId"::text, v_details);
  return null;
end;
$$;

comment on function ssbj_audit_member_role_change() is
  'SSBJ のロールの割り当て・変更・解除を操作履歴（ssbj_audit_logs。reportId は空）に記録する AFTER トリガー。';

create trigger audit_ssbj_member_roles
after insert or update or delete on ssbj_member_roles
for each row execute function ssbj_audit_member_role_change();
