-- 活動量の帳票（activity_evidence_files / activity_record_evidence）: 記録の根拠になる請求書などのファイル
--
-- ファイル本体は Storage の import-files に置く（{organizationId}/activity-evidence/{id}.{拡張子}）。ここに持つのは
-- ファイルの情報（名前・形式・大きさ・SHA-256）と、活動量の記録との紐づけ。1 枚の帳票を複数の記録に
-- （燃料の種類ごとなど）、1 件の記録に複数の帳票を（複数メーターなど）紐づけられる。
--
-- 帳票の行は、サーバ（POST /api/activity-evidence）が中身（先頭のバイト・大きさ）を確かめてから service_role で作る。
-- ブラウザから作らせると、確かめていないファイルや別のパスを指す行を作れてしまうため、authenticated には
-- insert / update / delete を許さない。削除もサーバ（DELETE /api/activity-evidence/[id]）が Storage の削除と合わせて行う。
-- 紐づけ（activity_record_evidence）は、記録と帳票が自組織のものであるときだけ、ブラウザから作れる・外せる。
-- 紐づけた人はトリガでログイン中のユーザーにし、紐づけ・外したことはトリガで system_audit_logs に残す。
-- 記録を削除すると紐づけだけが消え、帳票は残る（記録の削除で根拠資料を失わない）。紐づいている帳票は削除できない
-- （"evidenceFileId" の on delete restrict）。Storage の帳票のファイルも、ブラウザからは消させない（§3）。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。storage.buckets の update のみ例外）

-- §1 テーブル

create table activity_evidence_files (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "storagePath" text not null unique,
  "fileName" varchar(255) not null,
  "mimeType" varchar(50) not null,
  "sizeBytes" integer not null,
  sha256 char(64) not null,
  "convertedFrom" varchar(50),
  "uploadedBy" uuid,
  "createdAt" timestamptz not null default now(),
  constraint activity_evidence_files_mime_type_check
    check ("mimeType" in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  constraint activity_evidence_files_size_check check ("sizeBytes" > 0 and "sizeBytes" <= 10485760),
  constraint activity_evidence_files_converted_from_check
    check ("convertedFrom" is null or ("convertedFrom" in ('image/png', 'image/jpeg') and "mimeType" = 'image/webp'))
);

comment on table activity_evidence_files is
  '活動量の記録の根拠になる帳票（請求書など）のファイルの情報。本体は Storage の import-files に置く。';
comment on column activity_evidence_files."storagePath" is 'import-files の中のパス（{organizationId}/activity-evidence/{id}.{拡張子}）。';
comment on column activity_evidence_files."fileName" is 'アップロードしたときのファイル名（表示用。保存先のパスには使わない）。';
comment on column activity_evidence_files.sha256 is '保存したファイルの SHA-256（16 進）。同じファイルかどうか・改ざんの確認に使う。';
comment on column activity_evidence_files."convertedFrom" is
  '容量を減らすため WebP に変換して保存したときの元の形式（image/png / image/jpeg）。変換していなければ null。';

create index "activity_evidence_files_organizationId_idx" on activity_evidence_files ("organizationId", "createdAt");

create table activity_record_evidence (
  "activityRecordId" uuid not null references activity_records(id) on delete cascade,
  "evidenceFileId" uuid not null references activity_evidence_files(id) on delete restrict,
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "createdBy" uuid,
  "createdAt" timestamptz not null default now(),
  primary key ("activityRecordId", "evidenceFileId")
);

comment on table activity_record_evidence is
  '活動量の記録と帳票の紐づけ。記録を削除すると紐づけだけが消える（帳票は残る）。';
comment on column activity_record_evidence."createdBy" is
  '紐づけた人。ブラウザから作るときはトリガ（set_activity_record_evidence_actor）がログイン中のユーザーにする。';

create index activity_record_evidence_file_idx on activity_record_evidence ("evidenceFileId");
create index "activity_record_evidence_organizationId_idx" on activity_record_evidence ("organizationId");

-- 紐づけた人は、ブラウザの申告値ではなくログイン中のユーザーにする（set_row_actor と同じ形。
-- auth.uid() が無い service_role の書き込みは申告値のまま）。
create or replace function set_activity_record_evidence_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new."createdBy" := coalesce(auth.uid(), new."createdBy");
  return new;
end;
$$;

create trigger set_activity_record_evidence_actor
before insert on activity_record_evidence
for each row execute function set_activity_record_evidence_actor();

-- 紐づけた・外したことを system_audit_logs に残す（activity_evidence.link / activity_evidence.unlink）。
-- 紐づけはブラウザから PostgREST で直接作る・外すため、アプリの処理ではなくトリガで残す（どの経路でも漏れない）。
-- 記録の削除で紐づけが消えたときも unlink として残る。中身はファイル名と記録の ID だけ。
-- ログイン中のユーザーがいない書き込み（service_role・seed）は残さない（system_audit_logs."userId" は必須のため）。
create or replace function log_activity_record_evidence_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_link public.activity_record_evidence;
  v_user_id uuid := auth.uid();
  v_file_name text;
begin
  if v_user_id is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_link := new;
  else
    v_link := old;
  end if;
  select f."fileName" into v_file_name
  from public.activity_evidence_files f
  where f.id = v_link."evidenceFileId";

  insert into public.system_audit_logs ("organizationId", "userId", action, "entityName", "entityId", detail)
  values (
    v_link."organizationId",
    v_user_id,
    case when tg_op = 'INSERT' then 'activity_evidence.link' else 'activity_evidence.unlink' end,
    'activity_evidence_files',
    v_link."evidenceFileId",
    jsonb_build_object('activityRecordId', v_link."activityRecordId", 'fileName', v_file_name)::text
  );
  return null;
end;
$$;

create trigger log_activity_record_evidence_change
after insert or delete on activity_record_evidence
for each row execute function log_activity_record_evidence_change();

-- §2 RLS・権限

alter table activity_evidence_files enable row level security;
alter table activity_record_evidence enable row level security;

-- 自組織のメンバーは全員が帳票を見られる（ダウンロードは Storage の import_files_select_own_organization で絞る）。
create policy "activity_evidence_files_select_own_organization"
on activity_evidence_files
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "activity_record_evidence_select_own_organization"
on activity_record_evidence
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 紐づける記録と帳票の組織帰属は FK では担保できない（FK は行の存在しか見ない）ため、exists で両方を確かめる。
-- 確かめないと、PostgREST を直接叩いて他組織の帳票を自組織の記録に紐づけ、中身の情報を読めてしまう。
create policy "activity_record_evidence_insert_own_organization"
on activity_record_evidence
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from activity_records r
    where r.id = "activityRecordId"
      and r."organizationId" = (select current_user_organization_id())
  )
  and exists (
    select 1 from activity_evidence_files f
    where f.id = "evidenceFileId"
      and f."organizationId" = (select current_user_organization_id())
  )
);

create policy "activity_record_evidence_delete_own_organization"
on activity_record_evidence
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

grant select on activity_evidence_files to authenticated;
grant select, insert, update, delete on activity_evidence_files to service_role;
grant select, insert, delete on activity_record_evidence to authenticated;
grant select, insert, update, delete on activity_record_evidence to service_role;

-- §3 Storage

-- 帳票のファイル（{organizationId}/activity-evidence/）は、ブラウザから Storage を直接消させない。
-- 20260831000003_storage.sql の import_files_delete_own_organization のままだと、自組織のメンバーなら誰でも
-- 消せてしまい、紐づいている帳票を消せない制約（DELETE /api/activity-evidence/[id] の確認と on delete restrict）と
-- 監査ログ（activity_evidence.delete）を通らずに根拠資料を失う。削除は DELETE /api/activity-evidence/[id]
-- （service_role）だけが行う。ほかのフォルダの扱いは変えない。
alter policy "import_files_delete_own_organization"
on storage.objects
using (
  bucket_id = 'import-files'
  and (storage.foldername(name))[1] = (select public.current_user_organization_id())::text
  and (storage.foldername(name))[2] is distinct from 'activity-evidence'
);

-- 帳票は WebP でも保存できるようにする（スマートフォンで撮った画像や、容量を減らすために変換した画像）。
-- R12 の例外（storage.buckets の設定変更）。今の許可形式に image/webp を足すだけにする（Dashboard で設定を変えた
-- バケットの許可形式を狭めない）。allowed_mime_types が null（全形式を許可）のバケットは、そのままで WebP を置ける。
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'image/webp')
where id = 'import-files'
  and allowed_mime_types is not null
  and not ('image/webp' = any (allowed_mime_types));
