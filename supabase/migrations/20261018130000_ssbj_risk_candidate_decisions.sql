-- SSBJ 開示レポート: 業種から出したリスク・機会の候補への判断（採用・除外）（docs/ssbj-spec.md §13「業種から出す候補」）。
--
-- 候補は src/features/ssbj/utils/industryCandidates.ts の定数（DB からは見えない）。候補 ID がそこにあるかはアプリが検証し、
-- DB は形式だけを検証する。候補への判断は、候補を検討の出発点にしたかどうかの記録で、該当性・重要性の判断（ssbj_judgements）ではない。
-- 採用した候補は、登録したリスク・機会（ssbj_risks_opportunities）につなぐ。除外は理由を必須にする（後から根拠を確かめるため）。
-- 登録したリスク・機会が残っている間は、採用を取り消せない（取り消して再採用すると、同じリスク・機会が重複して登録されるため）。
-- 作業用の記録で保存版には含めない（保存版セクション・draftRevision の繰り上げは付けない）。
-- 承認済みの間は変更させず（reject_ssbj_change_when_approved）、操作履歴に記録する（ssbj_audit_row_change）。
-- 「採用して登録」は adopt_ssbj_risk_candidate（§5）で、リスク・機会の登録と採用の記録を 1 つのトランザクションで保存する。

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
  -- 採用して登録したリスク・機会の ID。外部キーにはしない: 保存版からの復元はリスク・機会を全部消して同じ ID で入れ直すため、
  -- on delete set null だと復元のたびに関連付けが切れる。登録したものが残っているかは、ID で存在を確かめて判定する
  -- （画面の ssbjCandidateStatus と adopt_ssbj_risk_candidate。削除済みなら「採用済み（削除済み）」として採用し直せる）。
  "riskOpportunityId" uuid,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_risk_candidate_decisions_report_candidate_key unique ("reportId", "candidateId"),
  constraint ssbj_risk_candidate_decisions_candidate_id_format check ("candidateId" ~ '^(common|[a-z]{2})\.[a-z0-9_]+$'),
  constraint ssbj_risk_candidate_decisions_decision_check check (decision in ('adopted', 'excluded')),
  -- 理由の前後の空白（改行・タブ・全角スペース・NBSP・BOM を含む）を除いて空なら、理由が無いものとする（差戻しの理由と同じ判定）。
  -- btrim() は半角スペースしか除かないため使わない（改行・タブだけの理由を通してしまう）。
  constraint ssbj_risk_candidate_decisions_excluded_reason check (
    decision <> 'excluded'
    or (reason is not null and regexp_replace(reason, '^[\s\u00a0\u3000\ufeff]+|[\s\u00a0\u3000\ufeff]+$', '', 'g') <> '')
  )
);

comment on table ssbj_risk_candidate_decisions is
  'SSBJ レポートで、業種から出したリスク・機会の候補への判断（採用・除外）。該当性・重要性の判断ではない。'
  '作業用の記録で、保存版には含めない（docs/ssbj-spec.md §13）。';
comment on column ssbj_risk_candidate_decisions."candidateId" is
  '候補 ID（例 common.carbon_pricing）。候補の一覧にあるかはアプリが検証する。作成後は変更不可。';
comment on column ssbj_risk_candidate_decisions.reason is '採用・除外の理由（内部の記録。開示しない）。除外では必須。';

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

-- 採用を取り消せる（未検討に戻せる）のは、登録したリスク・機会が残っていないときだけ。残ったまま取り消して再採用すると、
-- 同じリスク・機会が重複して登録される。条件に合わない行は削除されない（0 行）ので、アプリは削除した行数で確かめる。
-- レポート・組織の削除の連鎖（外部キーの on delete cascade）には RLS がかからないので、この条件で止まらない。
create policy "ssbj_risk_candidate_decisions_delete_own_organization"
on ssbj_risk_candidate_decisions
for delete
to authenticated
using (
  "organizationId" = (select current_user_organization_id())
  and not (
    decision = 'adopted'
    and exists (
      select 1 from ssbj_risks_opportunities ro
      where ro.id = "riskOpportunityId"
        and ro."reportId" = ssbj_risk_candidate_decisions."reportId"
    )
  )
);

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

-- §5 採用して登録（adopt_ssbj_risk_candidate）
-- リスク・機会の登録と、候補の採用の記録を 1 つのトランザクションで保存する。どちらかが失敗すれば両方とも残らない
-- （登録だけ残ると、再読込しても候補が未検討のままで、もう一度採用すると同じリスク・機会が重複して登録されるため）。
-- security invoker: 呼び出した利用者の RLS・列 GRANT・承認ロック・操作履歴のトリガーを、画面から直接書くときと同じように通す。
-- ロックの順番は利用者が画面から保存するときと同じ（20261009090000_ssbj_report_write_lock.sql）: 書き換える判断の行を先に for update でロックし、
-- レポートの行は承認ロックのトリガーに取らせる（lock_ssbj_report_working_rows は service_role 限定のため呼ばない）。
-- 業種はクライアントから受け取らず、レポートの基本情報の業種を記録する。
-- 同じ候補が既に採用されていて、登録したリスク・機会が残っていれば、関連付けを上書きせず競合（P2062）にする。
-- 採用したリスク・機会が削除済み（"riskOpportunityId" の行が無い）か、除外していた候補は、採用し直せる。
-- 状態の列（ssbj_field_state 型）は jsonb から取り出すと text になるので、型を明示して入れる。

create function adopt_ssbj_risk_candidate(
  p_report_id uuid,
  p_candidate_id varchar,
  p_candidate_version varchar,
  p_risk jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report ssbj_reports%rowtype;
  v_decision ssbj_risk_candidate_decisions%rowtype;
  v_has_decision boolean;
  v_risk ssbj_risks_opportunities%rowtype;
begin
  select * into v_report from ssbj_reports where id = p_report_id;
  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;

  -- 同じ候補を同時に採用したときに、後の方を待たせて競合にする。
  select * into v_decision
  from ssbj_risk_candidate_decisions
  where "reportId" = p_report_id and "candidateId" = p_candidate_id
  for update;
  v_has_decision := found;
  if v_has_decision and v_decision.decision = 'adopted' and exists (
    select 1 from ssbj_risks_opportunities ro
    where ro.id = v_decision."riskOpportunityId" and ro."reportId" = p_report_id
  ) then
    raise exception 'この候補は既に採用されています: %', p_candidate_id using errcode = 'P2062';
  end if;

  insert into ssbj_risks_opportunities (
    "organizationId", "reportId", kind, title, "riskTypeState", "riskType",
    "descriptionState", "descriptionText", "internalNote", "timeHorizonState", "timeHorizon", "linkTargets"
  )
  values (
    v_report."organizationId",
    p_report_id,
    p_risk->>'kind',
    p_risk->>'title',
    (p_risk->>'riskTypeState')::ssbj_field_state,
    p_risk->>'riskType',
    (p_risk->>'descriptionState')::ssbj_field_state,
    p_risk->>'descriptionText',
    p_risk->>'internalNote',
    (p_risk->>'timeHorizonState')::ssbj_field_state,
    p_risk->>'timeHorizon',
    coalesce(array(select jsonb_array_elements_text(p_risk->'linkTargets')), '{}')
  )
  returning * into v_risk;

  if v_has_decision then
    update ssbj_risk_candidate_decisions
    set decision = 'adopted',
        reason = null,
        "riskOpportunityId" = v_risk.id,
        "candidateVersion" = p_candidate_version,
        "industryCode" = v_report."industryCode"
    where id = v_decision.id
    returning * into v_decision;
  else
    begin
      insert into ssbj_risk_candidate_decisions (
        "organizationId", "reportId", "candidateId", "candidateVersion", "industryCode", decision, reason, "riskOpportunityId"
      )
      values (
        v_report."organizationId", p_report_id, p_candidate_id, p_candidate_version, v_report."industryCode", 'adopted', null, v_risk.id
      )
      returning * into v_decision;
    exception when unique_violation then
      -- 行ロックを取る前に、別の画面が同じ候補の判断を先に作った。
      raise exception 'この候補は他の画面で先に判断されました: %', p_candidate_id using errcode = 'P2062';
    end;
  end if;

  return jsonb_build_object(
    'riskOpportunity', jsonb_build_object(
      'id', v_risk.id,
      'kind', v_risk.kind,
      'title', v_risk.title,
      'riskTypeState', v_risk."riskTypeState",
      'riskType', v_risk."riskType",
      'descriptionState', v_risk."descriptionState",
      'descriptionText', v_risk."descriptionText",
      'internalNote', v_risk."internalNote",
      'timeHorizonState', v_risk."timeHorizonState",
      'timeHorizon', v_risk."timeHorizon",
      'linkTargets', to_jsonb(v_risk."linkTargets"),
      -- 一覧から続けて編集するときの競合検知の条件（riskOpportunityService.ts の updateSsbjRiskOpportunity）。
      'updatedAt', v_risk."updatedAt"
    ),
    'decision', jsonb_build_object(
      'candidateId', v_decision."candidateId",
      'candidateVersion', v_decision."candidateVersion",
      'industryCode', v_decision."industryCode",
      'decision', v_decision.decision,
      'reason', v_decision.reason,
      'riskOpportunityId', v_decision."riskOpportunityId",
      'updatedAt', v_decision."updatedAt"
    )
  );
end;
$$;

comment on function adopt_ssbj_risk_candidate(uuid, varchar, varchar, jsonb) is
  '業種から出した候補を採用して、リスク・機会を登録する（登録と採用の記録を 1 つのトランザクションで保存）。'
  '呼び出した利用者の権限で動く（security invoker）。P2031 = レポートが見えない、P2062 = 同じ候補が既に採用されている、P2051 = 承認済み。';

revoke execute on function adopt_ssbj_risk_candidate(uuid, varchar, varchar, jsonb) from public, anon;
grant execute on function adopt_ssbj_risk_candidate(uuid, varchar, varchar, jsonb) to authenticated;
