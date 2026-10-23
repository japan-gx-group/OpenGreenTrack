-- 組織のメンバーのロール（管理者・メンバー）: ロールを変える RPC と、最後の管理者を守るトリガー
--
-- ロールは profiles.role が 'admin' なら管理者、それ以外（'logger'・'viewer'）はメンバーとして扱う。判定は
-- 「role が admin か」だけで行う。新しくメンバーにするときに書く値は 'logger'（列の既定値）とし、'member' という値は
-- 足さない（既存の行を書き換えるデータの更新をマイグレーションに書けないため: AGENTS.md R12）。
--
-- ここで足すのは次の 2 つ。組織の設定（企業情報・算定年度・招待）の権限はまだ変えない
-- （current_user_is_admin() は「ログインしているか」を返したまま）。
--   §1 組織の管理者が 0 人になる変更（最後の管理者の降格・削除）を拒否するトリガー
--   §2 ロールを変える RPC（change_member_role）。操作する人が同じ組織の管理者であることを中で確かめる
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。関数本体 $$…$$ 内の DML は対象外）

-- §1 最後の管理者を守るトリガー
--
-- メンバーの削除・退会（auth.users の削除から profiles への連鎖）・ロールの変更のどの経路でも効くよう、profiles に付ける。
-- 組織そのものを削除するとき（organizations からの連鎖）は、残す管理者がいないので止めない（デモの seed が組織ごと入れ直す）。
-- 組織ごとのロックを取ってから数えるのは、2 人の管理者が同時に互いを降格したときに 0 人にならないようにするため。
-- 関数は VOLATILE（既定）なので、ロックを取ったあとの select は、先に確定した変更を見て数える。

create function ensure_organization_keeps_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checks_admins boolean;
begin
  -- 管理者だった行の削除と、管理者でなくなる・別の組織へ移る更新だけが、組織の管理者の人数を減らす
  v_checks_admins := old.role = 'admin'
    and (tg_op = 'DELETE' or new.role <> 'admin' or new."organizationId" <> old."organizationId");

  if v_checks_admins then
    perform pg_advisory_xact_lock(hashtext('organization_admins:' || old."organizationId"::text));

    -- 組織ごと削除している最中（organizations の行がもう無い）は止めない
    if exists (
      select 1
      from public.organizations o
      where o.id = old."organizationId"
    ) and not exists (
      select 1
      from public.profiles p
      where p."organizationId" = old."organizationId"
        and p.role = 'admin'
        and p.id <> old.id
    ) then
      raise exception '組織の管理者が 1 人もいなくなるため変更できません' using errcode = 'P2081';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function ensure_organization_keeps_admin() is
  '組織の管理者（profiles.role = ''admin''）が 0 人になる更新・削除を P2081 で拒否する。組織ごとの削除は止めない。';

create trigger ensure_organization_keeps_admin
before update of role, "organizationId" or delete on profiles
for each row execute function ensure_organization_keeps_admin();

-- §2 ロールを変える RPC
--
-- service_role で RLS を越えて呼ぶため、操作する人（p_actor_id）を引数で受け取り、同じ組織の管理者であることを
-- ここで確かめる（Server Action の確認と二重にする）。変更は system_audit_logs に同じトランザクションで残す。
-- 書ける値は 'admin'（管理者）と 'logger'（メンバー）だけ。管理者かどうかが変わらない変更（'viewer' → 'logger' など）は
-- 何もしない。最後の管理者を降格する変更は §1 のトリガーが P2081 で止める。

create function change_member_role(
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
  if p_role is null or p_role not in ('admin', 'logger') then
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

  if (v_previous_role = 'admin') = (p_role = 'admin') then
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
  'メンバーのロールを admin（管理者）/ logger（メンバー）に変える。操作する人が同じ組織の管理者であることを確かめ、'
  'system_audit_logs に member.role.update を残す。service_role 限定。';

revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function change_member_role(uuid, uuid, text) to service_role;
