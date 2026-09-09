-- 検査フィクスチャ（検出されない）: do ブロックが存在チェック（if exists (select …)）と
-- raise exception だけで DML を含まない。続く create unique index は DDL。
-- 重複がある環境で部分一意インデックスの作成が失敗する前に、原因を明示して止める形。
-- 期待する検出: なし
do $$
begin
  if exists (
    select 1
    from items
    where status = 'active'
      and "ownerId" is not null
    group by "ownerId", year, kind
    having count(*) > 1
  ) then
    raise exception '同条件の有効な行が複数存在します。重複を整理してから適用してください。';
  end if;

  if exists (
    select 1 from items where status = 'active' and "ownerId" is null
    group by year, kind having count(*) > 1
  ) then
    raise exception '同条件の共通行が複数存在します。重複を整理してから適用してください。';
  end if;
end $$;

create unique index if not exists items_active_owner_key_idx
  on items ("ownerId", year, kind)
  where status = 'active' and "ownerId" is not null;

create unique index if not exists items_active_shared_key_idx
  on items (year, kind)
  where status = 'active' and "ownerId" is null;
