-- 検査フィクスチャ（検出される）: 共通行から所有者別のコピーを作るデータ移行。
-- create temporary table … as select ×2 と insert … select を検出する。
-- do ブロック内の execute format('update …') は文字列で組み立てる動的 SQL のため検出しない（既知の限界）。
-- 期待する検出: create temporary table ×2 / insert 文（この順）
alter table items
  add column if not exists "ownerId" uuid references owners(id) on delete cascade;

create temporary table legacy_items as
select id, label, "createdAt"
from items
where "ownerId" is null;

create temporary table legacy_item_copies as
select gen_random_uuid() as id, o.id as "ownerId", legacy.id as "legacyId", legacy.label, legacy."createdAt"
from owners o
cross join legacy_items legacy;

insert into items (id, "ownerId", label, "createdAt")
select id, "ownerId", label, "createdAt"
from legacy_item_copies;

do $$
declare
  target record;
  orphan_count bigint;
begin
  for target in select table_name from information_schema.columns where column_name = 'itemId' loop
    execute format(
      'update public.%I r set "itemId" = c.id from pg_temp.legacy_item_copies c where r."itemId" = c."legacyId"',
      target.table_name
    );
    execute format('select count(*) from public.%I r join items i on i.id = r."itemId" where i."ownerId" is null', target.table_name)
      into orphan_count;
    if orphan_count > 0 then
      raise exception '所有者未割当の参照が % 件残っています: %', orphan_count, target.table_name;
    end if;
  end loop;
end $$;

drop table legacy_item_copies, legacy_items;
