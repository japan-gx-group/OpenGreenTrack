-- 検査フィクスチャ（検出される）: check 制約の差し替えに伴う既存行の update ×2。
-- 途中の関数本体（$$ … $$）は対象外。末尾の do ブロックは execute format('create policy …') だけ
-- （文字列で組み立てる動的 SQL）なので検出されない。
-- 期待する検出: update 文（DML）×2
alter table t drop constraint t_kind_check;
update t set kind = 'b' where kind = 'a';
alter table t add constraint t_kind_check check (kind in ('b', 'c'));

alter table items drop constraint items_kind_check;
update items set kind = 'b' where kind = 'a';
alter table items add constraint items_kind_check check (kind in ('b', 'c'));

create or replace function can_edit()
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.t where t.id = auth.uid() and t.kind = 'b')
$$;

revoke all on function can_edit() from public, anon, authenticated;
grant execute on function can_edit() to authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['t', 'items'] loop
    execute format(
      'create policy %I on %I as restrictive for update to authenticated using ((select can_edit()))',
      tbl || '_update_requires_editor', tbl
    );
  end loop;
end;
$$;

create policy "items_select_all" on items for select to authenticated using (true);
