-- GreenTrack v1.0 初期スキーマ (4/4): Storage
-- 目的: ファイル保存用バケットと、パス先頭フォルダ = organizationId による storage.objects の組織分離。
-- 収録: §1 バケット 2 つ / §2 storage.objects ポリシー 2 本。storage スキーマ本体（テーブル・RLS 有効化・GRANT・foldername()）は Supabase 管理のため触らない。
-- 適用順: 4 本の最後（ファイル名順）。
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。storage.buckets の insert / update のみ例外）

-- §1 バケット定義
-- ⚠️ 現時点でこの 2 バケットに書き込むアプリ経路は無い（ファイル取込機能は削除済み。
--    src/features/uploads/・src/app/api/file-uploads/・src/lib/fileValidation.ts は存在しない）。
--    取込を再導入するときの受け皿として定義だけを残している。
-- import-files: 取り込み原本の置き場。
-- upload-quarantine: サーバ検証前の一時置き場。ブラウザは service_role が発行する署名付きアップロード URL でのみ書き込め、検証通過分だけをサーバが import-files へ移す想定。
-- MIME は拡張子から確定し、未知拡張子は application/octet-stream にして HTML 等のインライン描画を防ぐ。file_size_limit は画面側の上限と同値。on conflict do nothing: Dashboard で先に作ったバケットを上書きしない。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('import-files', 'import-files', false, 52428800, array['text/csv', 'application/pdf', 'image/png', 'image/jpeg']),
  ('upload-quarantine', 'upload-quarantine', false, 52428800, null)
on conflict (id) do nothing;

-- §2 storage.objects のポリシー
-- insert / update ポリシーは意図的に置かない: ブラウザが直接書けるとサーバのファイル検証（ファイル名・サイズ・バイト列・MIME）を迂回できる。
-- 書き込みは upload-quarantine 経由の finalize（service_role。RLS を越えるためポリシー不要）のみ。
-- upload-quarantine 自体にもポリシーは張らない（ブラウザからの直接読み書きは不可）。

create policy "import_files_select_own_organization"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'import-files'
  and (storage.foldername(name))[1] = (select public.current_user_organization_id())::text
);

create policy "import_files_delete_own_organization"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'import-files'
  and (storage.foldername(name))[1] = (select public.current_user_organization_id())::text
);
