-- 検査フィクスチャ（検出されない）: storage.buckets への insert（バケット定義）は許容例外
-- （バケットはインフラ設定であり、Supabase 公式の作成手段が SQL のため。許容は insert / update のみ）。
-- 続く storage.objects のポリシーは DDL。
-- 期待する検出: なし
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do nothing;

create policy "files_select_own_owner"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'files'
  and (storage.foldername(name))[1] = (select public.current_owner_id())::text
);

create policy "files_insert_own_owner"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'files'
  and (storage.foldername(name))[1] = (select public.current_owner_id())::text
);

create policy "files_delete_own_owner"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'files'
  and (storage.foldername(name))[1] = (select public.current_owner_id())::text
);
