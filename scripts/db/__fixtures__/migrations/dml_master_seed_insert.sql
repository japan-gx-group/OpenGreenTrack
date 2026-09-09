-- 検査フィクスチャ（検出される）: マスタデータの insert … on conflict do update（upsert）。
-- 本番でも投入するマスタは migration ではなく seeds/production/ に置く（R12）。
-- 期待する検出: insert 文（DML）×1
insert into items as i (id, name, value, source)
values
  ('00000000-0000-0000-0000-000000000001', '品目 A', 1.5, 'a'),
  ('00000000-0000-0000-0000-000000000002', '品目 B', 2.0, 'a'),
  ('00000000-0000-0000-0000-000000000003', '品目 C', 0.25, 'b')
on conflict (id) do update set
  name = excluded.name,
  value = excluded.value,
  source = excluded.source
where (i.name, i.value, i.source) is distinct from (excluded.name, excluded.value, excluded.source);
