-- 検査フィクスチャ（検出されない）: storage.buckets への insert と update（許容例外）に、
-- create table / create index / grant / drop policy（DDL）が混在するファイル。
-- 期待する検出: なし
insert into storage.buckets (id, name, public, file_size_limit)
values ('quarantine', 'quarantine', false, 52428800)
on conflict (id) do nothing;

create table pending_uploads (
  id uuid primary key default gen_random_uuid(),
  "ownerId" uuid not null references owners(id) on delete cascade,
  "fileName" varchar(255) not null,
  "quarantineKey" varchar(500) not null unique,
  status text not null default 'pending' check (status in ('pending', 'finalizing')),
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null
);

create index pending_uploads_owner_idx on pending_uploads ("ownerId");
create index pending_uploads_expires_idx on pending_uploads ("expiresAt");

alter table pending_uploads enable row level security;

grant select, insert, update, delete on pending_uploads to service_role;

drop policy if exists "files_insert_own_owner" on storage.objects;
drop policy if exists "files_update_own_owner" on storage.objects;

update storage.buckets
set allowed_mime_types = array['text/csv', 'application/pdf', 'image/png', 'image/jpeg']
where id = 'files';
