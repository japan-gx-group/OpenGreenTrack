-- 検査フィクスチャ（検出される）: 投入済みの seed 行を訂正する update。
-- データの訂正は seed を直して再投入する。migration で update しない（R12）。
-- 期待する検出: update 文（DML）×1
update items
set source = 'b'
where id = '00000000-0000-0000-0000-000000000001'
  and source = 'a';
