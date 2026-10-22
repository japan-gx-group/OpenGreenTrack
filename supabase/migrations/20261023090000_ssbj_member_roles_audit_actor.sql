-- SSBJ 開示レポート（R2）: SSBJ のロールの解除の記録で、利用者の削除に伴う解除を、ロールを割り当てた人の操作として残さない
-- （20261010110000_ssbj_member_roles.sql の ssbj_audit_member_role_change を定義し直す。docs/database-design.md 3.20）。
--
-- 退会（POST /api/account/delete）とメンバーの削除（設定の saveMemberChanges）は、利用者のセッションを持たない管理クライアントで
-- auth.users を消す。auth.users → profiles → ssbj_member_roles の連鎖削除では auth.uid() が空になり、以前の定義は
-- 削除される行（OLD）の updatedByUserId、つまり最後にロールを割り当てた人を、今回の解除の操作者として記録していた。
-- 削除では、行に残っている更新者を操作者にしない。ログイン中の利用者（auth.uid()）か、service_role の処理が渡した操作者
-- （ssbj.actor_user_id。ssbj_audit_row_change と同じ）だけを使い、どちらも無ければ空にする（画面では「システム」）。
-- 利用者そのものが消えたことによる解除は、details の reason に 'member_deleted' を残し、画面で手動の解除と分けて表示する。
-- 割り当て・変更の記録は以前と同じ（行の updatedByUserId は、その操作で set_row_actor が書いた値のため）。

create or replace function ssbj_audit_member_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ssbj_member_roles%rowtype;
  v_action text;
  v_details jsonb;
  v_actor uuid := coalesce(auth.uid(), nullif(current_setting('ssbj.actor_user_id', true), '')::uuid);
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'delete';
    v_details := jsonb_build_object('previousRole', old.role);
    -- 利用者の削除（退会・メンバーの削除）に伴う連鎖削除。profiles の行はこの時点で消えている。
    if not exists (select 1 from public.profiles p where p.id = old."userId") then
      v_details := v_details || jsonb_build_object('reason', 'member_deleted');
    end if;
  elsif tg_op = 'INSERT' then
    v_row := new;
    v_action := 'create';
    v_details := jsonb_build_object('role', new.role);
    v_actor := coalesce(v_actor, new."updatedByUserId");
  else
    if new.role is not distinct from old.role then
      return null;
    end if;
    v_row := new;
    v_action := 'update';
    v_details := jsonb_build_object('role', new.role, 'previousRole', old.role);
    v_actor := coalesce(v_actor, new."updatedByUserId");
  end if;

  -- 組織の削除に伴う連鎖削除では記録しない（記録先の外部キーが消える組織を指すため。デモデータの入れ直しを止めない）。
  if not exists (select 1 from public.organizations o where o.id = v_row."organizationId") then
    return null;
  end if;

  insert into public.ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", details)
  values
    (v_row."organizationId", null, v_actor, v_action, 'member_role', v_row."userId"::text, v_details);
  return null;
end;
$$;

comment on function ssbj_audit_member_role_change() is
  'SSBJ のロールの割り当て・変更・解除を操作履歴（ssbj_audit_logs。reportId は空）に記録する AFTER トリガー。'
  '解除の操作者はログイン中の利用者か ssbj.actor_user_id だけ（利用者の削除に伴う解除は空で、details.reason = member_deleted）。';
