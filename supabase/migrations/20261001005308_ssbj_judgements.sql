-- SSBJ 開示レポート（試行版 R1）: 該当性・重要性・記載しない理由の判断（T09。docs/ssbj-spec.md §3〜§5・§10）。
--
-- 要求項目マスター（src/features/ssbj/utils/requirementMaster.ts）の要求ごとに、利用者が下した判断を記録する。
-- ソフトは判断を自動で決めない（既定はすべて「未確認」）。リスクの識別（ssbj_risks_opportunities）とは別の概念として、
-- 別のテーブル・別の画面で持つ。要求 ID がマスターにあるかはアプリで検証する（DB は形式だけを検証する）。
-- 保存版への取り込みは ssbj_snapshot_section__judgements（§10 の命名規約）で行い、版生成 RPC は変更しない。
--
-- 区分は enum ではなく check 制約にする（区分を見直すときに制約の張り替えだけで済ませるため。enum は値の削除・改名ができない）。
-- 記載しない理由: none = 記載する / not_material = 重要性がない（適用基準 第22項）/ transition_relief = 経過措置
-- （適用基準 第93項・第94項、気候基準 第102項・第103項）/ commercial_sensitivity = 機会の情報の商業上の機密
-- （適用基準 第13項〜第16項）/ other = その他。経過措置と商業上の機密は、記載しない旨の開示が求められる（画面で知らせる）。

-- §1 テーブル

create table ssbj_judgements (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  -- 要求 ID（§3。src/features/ssbj/utils/ids.ts の SSBJ_REQUIREMENT_ID_PATTERN と同じ形式）。
  "requirementId" varchar(20) not null,
  applicability varchar(20) not null default 'unconfirmed',
  materiality varchar(20) not null default 'unconfirmed',
  "omissionReason" varchar(30) not null default 'none',
  -- 開示する説明（例: 経過措置を適用している旨。§4 の状態＋値の対）と、内部の検討理由（§5。開示しない）。
  "explanationState" ssbj_field_state not null default 'unanswered',
  "explanationText" text,
  "internalReason" text,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_judgements_report_requirement_key unique ("reportId", "requirementId"),
  constraint ssbj_judgements_requirement_id_format check ("requirementId" ~ '^REQ-(APP|GEN|CLM)-\d{3}$'),
  constraint ssbj_judgements_applicability check (applicability in ('unconfirmed', 'applicable', 'not_applicable')),
  constraint ssbj_judgements_materiality check (materiality in ('unconfirmed', 'material', 'not_material')),
  constraint ssbj_judgements_omission_reason check (
    "omissionReason" in ('none', 'not_material', 'transition_relief', 'commercial_sensitivity', 'other')
  ),
  -- 「重要性がない」を理由に記載しないのは、重要性を「なし」と判断したときだけ。
  constraint ssbj_judgements_not_material_reason check (
    "omissionReason" <> 'not_material' or materiality = 'not_material'
  ),
  constraint ssbj_judgements_explanation_state check (
    ("explanationState" = 'answered' and "explanationText" is not null and btrim("explanationText") <> '')
    or ("explanationState" <> 'answered' and "explanationText" is null)
  )
);

comment on table ssbj_judgements is
  'SSBJ レポートの要求ごとの該当性・重要性・記載しない理由（作業中データ。レポートと要求 ID の組ごとに 1 行）。'
  'ソフトは判断を自動で決めない。保存版には ssbj_snapshot_section__judgements で取り込む（docs/ssbj-spec.md §8・§10）。';
comment on column ssbj_judgements."omissionReason" is
  'none / not_material（適用基準 第22項）/ transition_relief（適用基準 第93項・第94項、気候基準 第102項・第103項）/ '
  'commercial_sensitivity（適用基準 第13項〜第16項。機会の情報のみ）/ other。';
comment on column ssbj_judgements."internalReason" is '内部の検討理由。開示しない（§5）。';

-- §2 トリガー

create trigger set_ssbj_judgements_actor
before insert or update on ssbj_judgements
for each row execute function set_row_actor();

create trigger set_ssbj_judgements_updated_at
before update on ssbj_judgements
for each row execute function set_updated_at();

-- 作業中データの変更を ssbj_reports.draftRevision に反映する（§10 の手順2）。
create trigger bump_ssbj_judgements_draft_revision
after insert or update or delete on ssbj_judgements
for each row execute function bump_ssbj_draft_revision();

-- §3 RLS
-- レポートの組織帰属は FK では担保できない（FK は行の存在しか見ない）ため exists で検証する（§10 の手順1）。

alter table ssbj_judgements enable row level security;

create policy "ssbj_judgements_select_own_organization"
on ssbj_judgements
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_judgements_insert_own_organization"
on ssbj_judgements
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_judgements_update_own_organization"
on ssbj_judgements
for update
to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_judgements_delete_own_organization"
on ssbj_judgements
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT
-- insert / update は列指定にする: id・監査列・日時は DB が決め、組織・レポート・要求は作成時にだけ指定できる。

grant select, delete on ssbj_judgements to authenticated;
grant insert (
  "organizationId",
  "reportId",
  "requirementId",
  applicability,
  materiality,
  "omissionReason",
  "explanationState",
  "explanationText",
  "internalReason"
) on ssbj_judgements to authenticated;
grant update (
  applicability,
  materiality,
  "omissionReason",
  "explanationState",
  "explanationText",
  "internalReason"
) on ssbj_judgements to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。

-- §5 保存版セクション（§10 の手順3）
-- create_ssbj_report_version が名前（ssbj_snapshot_section__<key>）で自動収集し、snapshot.sections.judgements に入れる。
-- 形は src/features/ssbj/types.ts の SsbjJudgement[]（要求 ID の順）。行の無い要求は含めない（表示側で未確認とする）。

create function ssbj_snapshot_section__judgements(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'requirementId', j."requirementId",
        'applicability', j.applicability,
        'materiality', j.materiality,
        'omissionReason', j."omissionReason",
        'explanation', jsonb_build_object(
          'disclosure', ssbj_field_value_json(j."explanationState", j."explanationText"),
          'internalNote', j."internalReason"
        )
      ) order by j."requirementId"
    ),
    '[]'::jsonb
  )
  from ssbj_judgements j
  where j."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__judgements(uuid) is
  '保存版の sections.judgements。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__judgements(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__judgements(uuid) to service_role;
