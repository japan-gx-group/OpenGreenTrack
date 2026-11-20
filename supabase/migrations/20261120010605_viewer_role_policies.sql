-- 閲覧者（viewer）を読み取り専用にする: current_user_can_edit() を差し替え、書き込みポリシーに restrictive ポリシーを重ねる
--
-- 20260831000001_rls.sql の current_user_can_edit() は将来用の定義で、これまで「ログインしているか」だけを返していた。
-- 本体を「自分の profiles 行があり、role が viewer でない」に差し替える（profiles 行が無い利用者も書けない）。
-- 既存の permissive ポリシー（組織の境界）は変えず、as restrictive のポリシーで role の条件だけを足す。
-- 既存の viewer の行は書き換えない（R12）。この変更で、既存の viewer は読み取り専用になる。
-- service_role の経路は RLS が効かないため、アプリ層での強制が別に要る。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用）

create or replace function public.current_user_can_edit()
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
      and p.role <> 'viewer'
  )
$$;

comment on function public.current_user_can_edit() is
  'ログイン中の利用者に profiles 行があり、role が viewer でなければ true を返す。組織の境界は既存のポリシーが担う。';

-- 既存の permissive な書き込みポリシーに、role の条件を restrictive ポリシーで重ねる。
-- 閲覧者の SELECT を残すため、FOR ALL は使わない（insert / update / delete ごとに作る）。

create policy "suppliers_insert_requires_editor"
on public.suppliers
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "suppliers_update_requires_editor"
on public.suppliers
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "suppliers_delete_requires_editor"
on public.suppliers
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "locations_insert_requires_editor"
on public.locations
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "locations_update_requires_editor"
on public.locations
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "locations_delete_requires_editor"
on public.locations
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "emission_factors_insert_requires_editor"
on public.emission_factors
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "emission_factors_update_requires_editor"
on public.emission_factors
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "emission_factors_delete_requires_editor"
on public.emission_factors
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "activity_records_insert_requires_editor"
on public.activity_records
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "activity_records_update_requires_editor"
on public.activity_records
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "activity_records_delete_requires_editor"
on public.activity_records
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "scope3_category_emissions_insert_requires_editor"
on public.scope3_category_emissions
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "scope3_category_emissions_update_requires_editor"
on public.scope3_category_emissions
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "scope3_category_emissions_delete_requires_editor"
on public.scope3_category_emissions
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "supplier_emissions_insert_requires_editor"
on public.supplier_emissions
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "supplier_emissions_update_requires_editor"
on public.supplier_emissions
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "supplier_emissions_delete_requires_editor"
on public.supplier_emissions
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "scope3_category_methods_insert_requires_editor"
on public.scope3_category_methods
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "scope3_category_methods_update_requires_editor"
on public.scope3_category_methods
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "scope3_category_methods_delete_requires_editor"
on public.scope3_category_methods
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "reduction_targets_insert_requires_editor"
on public.reduction_targets
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "reduction_targets_update_requires_editor"
on public.reduction_targets
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "reduction_targets_delete_requires_editor"
on public.reduction_targets
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "reduction_target_years_insert_requires_editor"
on public.reduction_target_years
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "reduction_target_years_update_requires_editor"
on public.reduction_target_years
as restrictive for update to authenticated
using ((select public.current_user_can_edit()))
with check ((select public.current_user_can_edit()));

create policy "reduction_target_years_delete_requires_editor"
on public.reduction_target_years
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

create policy "activity_record_evidence_insert_requires_editor"
on public.activity_record_evidence
as restrictive for insert to authenticated
with check ((select public.current_user_can_edit()));

create policy "activity_record_evidence_delete_requires_editor"
on public.activity_record_evidence
as restrictive for delete to authenticated
using ((select public.current_user_can_edit()));

-- Storage は import-files のバケットだけを対象にする。既存の削除ポリシーが持つ
-- activity-evidence フォルダの除外は、管理者・メンバーにも閲覧者にもそのまま効く。
create policy "import_files_delete_requires_editor"
on storage.objects
as restrictive for delete to authenticated
using (
  bucket_id <> 'import-files'
  or (select public.current_user_can_edit())
);

-- 自分の氏名・電話の更新と、レポート出力の記録（system_audit_logs の insert）は閲覧者にも残す。
-- change_member_role: 許可する値に viewer を足し、変更の有無を「admin か否か」でなくロール値そのもので比べる
-- （メンバー↔閲覧者の変更が no-op にならないようにする）。操作する人が管理者であることの確認、
-- service_role 限定の実行権限はそのまま。最後の管理者の保護は既存のトリガーが引き続き担う（閲覧者への降格も含む）。

create or replace function change_member_role(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_actor_role text;
  v_previous_role text;
begin
  if p_role is null or p_role not in ('admin', 'logger', 'viewer') then
    raise exception 'ロールの値が正しくありません: %', p_role using errcode = 'P2084';
  end if;

  select "organizationId" into v_organization_id
  from profiles
  where id = p_actor_id;
  if not found then
    raise exception '管理者のみロールを変更できます' using errcode = 'P2082';
  end if;

  -- 同じ組織のロールの変更・最後の管理者の確認（§1）と直列化してから、操作する人のロールを読み直す
  perform pg_advisory_xact_lock(hashtext('organization_admins:' || v_organization_id::text));

  select role into v_actor_role
  from profiles
  where id = p_actor_id
    and "organizationId" = v_organization_id;
  if not found or v_actor_role <> 'admin' then
    raise exception '管理者のみロールを変更できます' using errcode = 'P2082';
  end if;

  select role into v_previous_role
  from profiles
  where id = p_target_user_id
    and "organizationId" = v_organization_id
  for update;
  if not found then
    raise exception '対象のメンバーが見つかりません: %', p_target_user_id using errcode = 'P2083';
  end if;

  if v_previous_role = p_role then
    return jsonb_build_object('changed', false, 'previousRole', v_previous_role, 'role', v_previous_role);
  end if;

  update profiles
  set role = p_role
  where id = p_target_user_id;

  insert into system_audit_logs ("organizationId", "userId", action, "entityName", "entityId", detail)
  values (
    v_organization_id,
    p_actor_id,
    'member.role.update',
    'profiles',
    p_target_user_id,
    jsonb_build_object('previousRole', v_previous_role, 'role', p_role)::text
  );

  return jsonb_build_object('changed', true, 'previousRole', v_previous_role, 'role', p_role);
end;
$$;

comment on function change_member_role(uuid, uuid, text) is
  'メンバーのロールを admin（管理者）/ logger（メンバー）/ viewer（閲覧者）に変える。操作する人が同じ組織の管理者であることを確かめ、'
  'system_audit_logs に member.role.update を残す。service_role 限定。';

revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function change_member_role(uuid, uuid, text) to service_role;
