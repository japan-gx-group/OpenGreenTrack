-- 検査フィクスチャ（検出されない）: create or replace function だけの migration。
-- 関数本体内の update / with … update（CTE 経由の DML）/ perform / select … for update は
-- いずれも関数本体（$$ … $$）の中なので対象外。
-- 期待する検出: なし
create or replace function complete_import(p_import_id uuid, p_owner_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_status text;
  v_unmapped integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('import:' || p_owner_id::text));

  select status into v_status from imports where id = p_import_id for update;
  if v_status <> 'processing' then
    raise exception '取込中ではありません: %', v_status using errcode = 'P0001';
  end if;

  update items i
  set "importId" = p_import_id
  from imports old
  where i."importId" = old.id and old.id <> p_import_id and i."isDone" = false;

  with orphaned as (
    update items set "importId" = null
    where "importId" <> p_import_id and "isDone" = false
    returning id
  )
  select count(*) into v_unmapped from orphaned;

  update imports set "isActive" = false where "ownerId" = p_owner_id and id <> p_import_id;
  update imports set status = 'completed', "unmappedCount" = v_unmapped, "isActive" = true
  where id = p_import_id;

  return jsonb_build_object('unmappedCount', v_unmapped);
end;
$$;
