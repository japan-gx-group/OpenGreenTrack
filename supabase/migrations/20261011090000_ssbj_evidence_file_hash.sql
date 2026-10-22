-- SSBJ 開示レポート: 根拠文書に、ファイルの SHA-256 と保管先での版を記録する（docs/ssbj-spec.md §5・§13）。
--
-- 資料名・版・保管先を文字で記録するだけでは、承認した後にファイルが差し替えられても気づけない。
-- 利用者がファイルを選ぶと、ブラウザの中で SHA-256 を計算し、その値だけをここに記録する。
-- ファイル本体はアップロードも保存もしない（後でファイルを選び直して、記録した値と比べる）。
-- すべて内部記録（§5）。開示用参照文とは別の列に持ち、既存の行は書き換えない（R12。どの列も既定は null）。

-- §1 列と制約

alter table ssbj_evidence
  add column "fileName" text,
  add column "fileSha256" text,
  add column "fileStorageVersionId" text,
  add column "fileStoredBy" text,
  add column "fileRecordedAt" timestamptz;

-- SHA-256 は小文字の 16 進 64 文字に揃える（画面は小文字で送る。大文字・空白入りは形式違いとして拒否する）。
-- ファイル名・SHA-256・記録日時は、同じファイルを選んだときに一緒に決まるため、3 つとも有るか 3 つとも無いかにする。
alter table ssbj_evidence
  add constraint ssbj_evidence_file_sha256_check check ("fileSha256" ~ '^[0-9a-f]{64}$'),
  add constraint ssbj_evidence_file_name_not_blank check (btrim("fileName") <> ''),
  add constraint ssbj_evidence_file_record_check check (
    ("fileSha256" is null) = ("fileName" is null)
    and ("fileSha256" is null) = ("fileRecordedAt" is null)
  );

comment on column ssbj_evidence."fileName" is '記録したファイルの名前（内部記録）。';
comment on column ssbj_evidence."fileSha256" is
  '記録したファイルの SHA-256（小文字の 16 進 64 文字。内部記録）。ブラウザの中で計算し、ファイル本体は保存しない。';
comment on column ssbj_evidence."fileStorageVersionId" is '保管先（文書管理の仕組みなど）でのファイルの版 ID（任意・内部記録）。';
comment on column ssbj_evidence."fileStoredBy" is 'ファイルを保管先に保存した担当（任意・内部記録）。';
comment on column ssbj_evidence."fileRecordedAt" is
  'ファイル名・SHA-256 を記録した日時。DB が決める（利用者は書けない）。';

-- 記録日時は利用者に書かせない（列の権限を与えない）。ファイル名・SHA-256 が変わったときだけ DB が now() にする。
grant insert ("fileName", "fileSha256", "fileStorageVersionId", "fileStoredBy"),
  update ("fileName", "fileSha256", "fileStorageVersionId", "fileStoredBy")
  on ssbj_evidence to authenticated;

-- §2 記録日時を決めるトリガー

create function set_ssbj_evidence_file_recorded_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new."fileSha256" is null then
    new."fileRecordedAt" := null;
  elsif tg_op = 'INSERT' then
    -- 利用者（authenticated）は列の権限が無いため、常に null で来て now() になる。
    -- 版の復元（service_role）は、版に残っている記録日時をそのまま戻す。
    new."fileRecordedAt" := coalesce(new."fileRecordedAt", now());
  elsif new."fileSha256" is distinct from old."fileSha256" or new."fileName" is distinct from old."fileName" then
    new."fileRecordedAt" := now();
  else
    new."fileRecordedAt" := old."fileRecordedAt";
  end if;
  return new;
end;
$$;

comment on function set_ssbj_evidence_file_recorded_at() is
  '根拠文書のファイル名・SHA-256 を記録した日時を決める BEFORE INSERT/UPDATE トリガー。';

create trigger set_ssbj_evidence_file_recorded_at
before insert or update on ssbj_evidence
for each row execute function set_ssbj_evidence_file_recorded_at();

-- §3 保存版への取り込みと、保存版からの復元に、ファイルの記録を加える
-- （関数名・引数は変えない。create or replace は既存の権限を保つ）。
-- この列を足す前の保存版にはキーが無い。復元では ->> が null を返すため、ファイルの記録の無い行として戻る。

create or replace function ssbj_snapshot_section__evidence(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'itemId', e."itemId",
        'documentTitle', e."documentTitle",
        'documentVersion', e."documentVersion",
        'internalLocation', e."internalLocation",
        'referencePosition', e."referencePosition",
        'ownerDepartment', e."ownerDepartment",
        'fileName', e."fileName",
        'fileSha256', e."fileSha256",
        'fileStorageVersionId', e."fileStorageVersionId",
        'fileStoredBy', e."fileStoredBy",
        'fileRecordedAt', e."fileRecordedAt",
        'disclosure', case when e."disclosureState" = 'answered'
          then jsonb_build_object('state', e."disclosureState", 'value', e."disclosureText")
          else jsonb_build_object('state', e."disclosureState")
        end
      ) order by e."itemId", e."createdAt", e.id
    ),
    '[]'::jsonb
  )
  from ssbj_evidence e
  where e."reportId" = p_report_id;
$$;

create or replace function ssbj_restore_section__evidence(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_evidence where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'array' then
    return;
  end if;
  insert into ssbj_evidence
    (id, "organizationId", "reportId", "itemId", "documentTitle", "documentVersion", "internalLocation",
     "referencePosition", "ownerDepartment", "disclosureState", "disclosureText",
     "fileName", "fileSha256", "fileStorageVersionId", "fileStoredBy", "fileRecordedAt",
     "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
  select
    (e.value ->> 'id')::uuid, p_organization_id, p_report_id, e.value ->> 'itemId', e.value ->> 'documentTitle',
    e.value ->> 'documentVersion', e.value ->> 'internalLocation', e.value ->> 'referencePosition',
    e.value ->> 'ownerDepartment',
    (e.value -> 'disclosure' ->> 'state')::ssbj_field_state, e.value -> 'disclosure' ->> 'value',
    -- 記録日時も版に残っているものを戻す（ファイルを記録し直したわけではないため）。
    e.value ->> 'fileName', e.value ->> 'fileSha256', e.value ->> 'fileStorageVersionId',
    e.value ->> 'fileStoredBy', (e.value ->> 'fileRecordedAt')::timestamptz,
    p_actor_user_id, p_actor_user_id,
    now() + make_interval(secs => e.ordinality / 1000.0), now() + make_interval(secs => e.ordinality / 1000.0)
  from jsonb_array_elements(p_section) with ordinality as e(value, ordinality);
end;
$$;
