-- SSBJ 開示レポート: 業種から出したリスク・機会の候補への判断（採用・除外）（docs/ssbj-spec.md §13「業種から出す候補」）。
--
-- 候補は src/features/ssbj/utils/industryCandidates.ts の定数（DB からは見えない）。候補 ID がそこにあるかはアプリが検証し、
-- DB は形式だけを検証する。候補への判断は、候補を検討の出発点にしたかどうかの記録で、該当性・重要性の判断（ssbj_judgements）ではない。
-- 採用した候補は、登録したリスク・機会（ssbj_risks_opportunities）につなぐ。除外は理由を必須にする（後から根拠を確かめるため）。
-- 作業用の記録で保存版には含めない（保存版セクション・draftRevision の繰り上げは付けない）。
-- 承認済みの間は変更させず（reject_ssbj_change_when_approved）、操作履歴に記録する（ssbj_audit_row_change）。

-- §1 テーブル

create table ssbj_risk_candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  -- 候補 ID（utils/industryCandidates.ts の SSBJ_CANDIDATE_ID_PATTERN と同じ形式）。
  "candidateId" varchar(100) not null,
  -- 判断したときの候補の定義の版と、レポートの業種（SICS の産業コード）。
  "candidateVersion" varchar(30) not null,
  "industryCode" varchar(10),
  decision varchar(20) not null,
  -- 採用・除外の理由（内部の記録。開示しない）。
  reason text,
  -- 採用して登録したリスク・機会。登録したものを削除したら NULL にする（判断の記録は残す）。
  "riskOpportunityId" uuid references ssbj_risks_opportunities(id) on delete set null,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_risk_candidate_decisions_report_candidate_key unique ("reportId", "candidateId"),
  constraint ssbj_risk_candidate_decisions_candidate_id_format check ("candidateId" ~ '^(common|[a-z]{2})\.[a-z0-9_]+$'),
  constraint ssbj_risk_candidate_decisions_decision_check check (decision in ('adopted', 'excluded')),
  constraint ssbj_risk_candidate_decisions_excluded_reason check (
    decision <> 'excluded' or (reason is not null and btrim(reason) <> '')
  )
);

comment on table ssbj_risk_candidate_decisions is
  'SSBJ レポートで、業種から出したリスク・機会の候補への判断（採用・除外）。該当性・重要性の判断ではない。'
  '作業用の記録で、保存版には含めない（docs/ssbj-spec.md §13）。';
comment on column ssbj_risk_candidate_decisions."candidateId" is
  '候補 ID（例 common.carbon_pricing）。候補の一覧にあるかはアプリが検証する。作成後は変更不可。';
comment on column ssbj_risk_candidate_decisions.reason is '採用・除外の理由（内部の記録。開示しない）。除外では必須。';

create index ssbj_risk_candidate_decisions_risk_idx on ssbj_risk_candidate_decisions ("riskOpportunityId");

-- §2 トリガー

create trigger set_ssbj_risk_candidate_decisions_actor
before insert or update on ssbj_risk_candidate_decisions
for each row execute function set_row_actor();

create trigger set_ssbj_risk_candidate_decisions_updated_at
before update on ssbj_risk_candidate_decisions
for each row execute function set_updated_at();

create trigger reject_ssbj_risk_candidate_decisions_when_approved
before insert or update or delete on ssbj_risk_candidate_decisions
for each row execute function reject_ssbj_change_when_approved();

create trigger audit_ssbj_risk_candidate_decisions
after insert or update or delete on ssbj_risk_candidate_decisions
for each row execute function ssbj_audit_row_change('risk_candidate', 'candidateId');

-- §3 RLS
-- レポートの組織帰属と、つなぐリスク・機会が同じレポートのものかは exists で検証する（FK は行の存在しか見ない）。

alter table ssbj_risk_candidate_decisions enable row level security;

create policy "ssbj_risk_candidate_decisions_select_own_organization"
on ssbj_risk_candidate_decisions
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_risk_candidate_decisions_insert_own_organization"
on ssbj_risk_candidate_decisions
for insert
to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId"
      and r."organizationId" = (select current_user_organization_id())
  )
  and (
    "riskOpportunityId" is null
    or exists (
      select 1 from ssbj_risks_opportunities ro
      where ro.id = "riskOpportunityId"
        and ro."reportId" = ssbj_risk_candidate_decisions."reportId"
    )
  )
);

create policy "ssbj_risk_candidate_decisions_update_own_organization"
on ssbj_risk_candidate_decisions
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
  and (
    "riskOpportunityId" is null
    or exists (
      select 1 from ssbj_risks_opportunities ro
      where ro.id = "riskOpportunityId"
        and ro."reportId" = ssbj_risk_candidate_decisions."reportId"
    )
  )
);

create policy "ssbj_risk_candidate_decisions_delete_own_organization"
on ssbj_risk_candidate_decisions
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT
-- insert / update は列指定にする: 組織・レポート・候補は作成時にだけ指定できる。

grant select, delete on ssbj_risk_candidate_decisions to authenticated;
grant insert (
  "organizationId",
  "reportId",
  "candidateId",
  "candidateVersion",
  "industryCode",
  decision,
  reason,
  "riskOpportunityId"
) on ssbj_risk_candidate_decisions to authenticated;
grant update (
  "candidateVersion",
  "industryCode",
  decision,
  reason,
  "riskOpportunityId"
) on ssbj_risk_candidate_decisions to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。
