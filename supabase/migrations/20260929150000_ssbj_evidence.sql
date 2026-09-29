-- SSBJ 開示レポート（試行版 R1）: 項目ごとの根拠文書参照と主管部署。
-- 保管先などの内部記録は開示用参照文とは別列に保持する。

create table ssbj_evidence (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  "itemId" text not null,
  "documentTitle" text not null,
  "documentVersion" text,
  "internalLocation" text,
  "referencePosition" text,
  "ownerDepartment" text,
  "disclosureState" ssbj_field_state not null default 'unanswered',
  "disclosureText" text,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_evidence_item_id_check check (
    "itemId" ~ '^(governance|strategy|risk_management|metrics_targets)\.[a-z0-9_]+$'
  ),
  constraint ssbj_evidence_document_title_not_blank check (btrim("documentTitle") <> ''),
  constraint ssbj_evidence_disclosure_state_check check (
    ("disclosureState" = 'answered' and "disclosureText" is not null and btrim("disclosureText") <> '')
    or ("disclosureState" <> 'answered' and "disclosureText" is null)
  )
);

comment on table ssbj_evidence is
  'SSBJレポートの項目ごとの根拠文書参照（作業中データ）。主管部署は任意入力。';
comment on column ssbj_evidence."internalLocation" is '社内の保管先。開示内容欄には出さない。';
comment on column ssbj_evidence."disclosureText" is '開示用の参照文。内部保管先とは別列で保持する。';

create index ssbj_evidence_report_item_idx on ssbj_evidence ("reportId", "itemId", "createdAt");

create trigger set_ssbj_evidence_actor
before insert or update on ssbj_evidence
for each row execute function set_row_actor();

create trigger set_ssbj_evidence_updated_at
before update on ssbj_evidence
for each row execute function set_updated_at();

create trigger bump_ssbj_evidence_draft_revision
after insert or update or delete on ssbj_evidence
for each row execute function bump_ssbj_draft_revision();

alter table ssbj_evidence enable row level security;

create policy "ssbj_evidence_select_own_organization"
on ssbj_evidence for select to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_evidence_insert_own_organization"
on ssbj_evidence for insert to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_evidence_update_own_organization"
on ssbj_evidence for update to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_evidence_delete_own_organization"
on ssbj_evidence for delete to authenticated
using ("organizationId" = (select current_user_organization_id()));

grant select, delete on ssbj_evidence to authenticated;
grant insert (
  "organizationId", "reportId", "itemId", "documentTitle", "documentVersion",
  "internalLocation", "referencePosition", "ownerDepartment", "disclosureState", "disclosureText"
) on ssbj_evidence to authenticated;
grant update (
  "itemId", "documentTitle", "documentVersion", "internalLocation",
  "referencePosition", "ownerDepartment", "disclosureState", "disclosureText"
) on ssbj_evidence to authenticated;

create function ssbj_snapshot_section__evidence(p_report_id uuid)
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

comment on function ssbj_snapshot_section__evidence(uuid) is
  '保存版の sections.evidence。create_ssbj_report_version が自動収集する。service_role 限定。';

revoke execute on function ssbj_snapshot_section__evidence(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__evidence(uuid) to service_role;
