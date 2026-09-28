-- SSBJ 開示レポート（試行版 R1）: リスクの種類と、時間軸の定義（docs/ssbj-spec.md §10・§12）。
--
-- 気候関連開示基準は、識別したリスクごとに物理的リスクか移行リスクかを（第19項(2)）、
-- レポートとして「短期」「中期」「長期」の定義とその定義と戦略上の計画期間との関係を（第19項(4)(5)、
-- 一般開示基準第14項(3)(4)）開示するよう求めている。R1 の初回対象に含めるため追加する。
-- 既存の行を書き換えないよう（R12）、どちらも状態＋値の対で持ち、既定は未入力にする。

-- §1 値の状態を jsonb（SsbjFieldValue と同じ { state, value? }）にする共通関数
-- 保存版セクション関数から使う。名前を ssbj_snapshot_section__ で始めないこと（版生成 RPC が自動収集してしまう）。

create function ssbj_field_value_json(p_state ssbj_field_state, p_value text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_state = 'answered' then jsonb_build_object('state', p_state, 'value', p_value)
    else jsonb_build_object('state', coalesce(p_state, 'unanswered'::ssbj_field_state))
  end;
$$;

comment on function ssbj_field_value_json(ssbj_field_state, text) is
  '状態＋値の対を SsbjFieldValue 形式の jsonb にする。状態が null（行が無い）の場合は未入力として扱う。';

revoke execute on function ssbj_field_value_json(ssbj_field_state, text) from public, anon, authenticated;
grant execute on function ssbj_field_value_json(ssbj_field_state, text) to service_role;

-- §2 リスクの種類（ssbj_risks_opportunities）

alter table ssbj_risks_opportunities
  add column "riskTypeState" ssbj_field_state not null default 'unanswered',
  add column "riskType" varchar(20);

-- 区分は check 制約（時間軸と同じく、区分の追加・変更を制約の張り替えだけで済ませるため）。
-- 機会は分類しない（第19項(2)はリスクだけに求めている）。
alter table ssbj_risks_opportunities
  add constraint ssbj_risks_opportunities_risk_type_check check ("riskType" in ('physical', 'transition')),
  add constraint ssbj_risks_opportunities_risk_type_state_check check (
    ("riskTypeState" = 'answered' and "riskType" is not null)
    or ("riskTypeState" <> 'answered' and "riskType" is null)
  ),
  add constraint ssbj_risks_opportunities_risk_type_kind_check check (kind = 'risk' or "riskType" is null);

comment on column ssbj_risks_opportunities."riskType" is
  'リスクの種類: physical（物理的リスク）/ transition（移行リスク）。機会は持たない。';

grant insert ("riskTypeState", "riskType"), update ("riskTypeState", "riskType")
  on ssbj_risks_opportunities to authenticated;

-- 保存版セクションにリスクの種類を加える（関数名・引数は変えない。create or replace は既存の権限を保つ）。
create or replace function ssbj_snapshot_section__risks_opportunities(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ro.id,
        'kind', ro.kind,
        'title', ro.title,
        'riskType', ssbj_field_value_json(ro."riskTypeState", ro."riskType"),
        'description', jsonb_build_object(
          'disclosure', ssbj_field_value_json(ro."descriptionState", ro."descriptionText"),
          'internalNote', ro."internalNote"
        ),
        'timeHorizon', ssbj_field_value_json(ro."timeHorizonState", ro."timeHorizon"),
        'linkTargets', to_jsonb(ro."linkTargets")
      )
      order by ro."createdAt", ro.id
    ),
    '[]'::jsonb
  )
  from ssbj_risks_opportunities ro
  where ro."reportId" = p_report_id;
$$;

-- §3 時間軸の定義（ssbj_report_time_horizons。レポートごとに 1 行）

create table ssbj_report_time_horizons (
  "reportId" uuid primary key references ssbj_reports(id) on delete cascade,
  "organizationId" uuid not null references organizations(id) on delete cascade,
  -- 企業による「短期」「中期」「長期」の定義（開示する文章。§4 の状態＋値の対）
  "shortTermState" ssbj_field_state not null default 'unanswered',
  "shortTerm" text,
  "mediumTermState" ssbj_field_state not null default 'unanswered',
  "mediumTerm" text,
  "longTermState" ssbj_field_state not null default 'unanswered',
  "longTerm" text,
  -- 上の定義と、戦略上の意思決定に用いる計画期間との関係
  "planningHorizonRelationState" ssbj_field_state not null default 'unanswered',
  "planningHorizonRelation" text,
  -- 内部記録（§5。開示欄には出さない）
  "internalNote" text,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_report_time_horizons_short_term_check check (
    ("shortTermState" = 'answered' and "shortTerm" is not null and btrim("shortTerm") <> '')
    or ("shortTermState" <> 'answered' and "shortTerm" is null)
  ),
  constraint ssbj_report_time_horizons_medium_term_check check (
    ("mediumTermState" = 'answered' and "mediumTerm" is not null and btrim("mediumTerm") <> '')
    or ("mediumTermState" <> 'answered' and "mediumTerm" is null)
  ),
  constraint ssbj_report_time_horizons_long_term_check check (
    ("longTermState" = 'answered' and "longTerm" is not null and btrim("longTerm") <> '')
    or ("longTermState" <> 'answered' and "longTerm" is null)
  ),
  constraint ssbj_report_time_horizons_planning_relation_check check (
    ("planningHorizonRelationState" = 'answered'
      and "planningHorizonRelation" is not null and btrim("planningHorizonRelation") <> '')
    or ("planningHorizonRelationState" <> 'answered' and "planningHorizonRelation" is null)
  )
);

comment on table ssbj_report_time_horizons is
  'SSBJ 開示レポートの時間軸の定義（作業中データ。気候関連開示基準 第19項(4)(5)）。レポートごとに 1 行。'
  '保存版には ssbj_snapshot_section__time_horizons で取り込む（docs/ssbj-spec.md §10）。';

create index ssbj_report_time_horizons_organization_idx
  on ssbj_report_time_horizons ("organizationId");

create trigger set_ssbj_report_time_horizons_actor
before insert or update on ssbj_report_time_horizons
for each row execute function set_row_actor();

create trigger set_ssbj_report_time_horizons_updated_at
before update on ssbj_report_time_horizons
for each row execute function set_updated_at();

create trigger bump_ssbj_report_time_horizons_draft_revision
after insert or update or delete on ssbj_report_time_horizons
for each row execute function bump_ssbj_draft_revision();

-- RLS: 組織分離。レポートの組織帰属は FK では担保できないため exists で検証する（§10 の手順1）。

alter table ssbj_report_time_horizons enable row level security;

create policy "ssbj_report_time_horizons_select_own_organization"
on ssbj_report_time_horizons
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_report_time_horizons_insert_own_organization"
on ssbj_report_time_horizons
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

create policy "ssbj_report_time_horizons_update_own_organization"
on ssbj_report_time_horizons
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

create policy "ssbj_report_time_horizons_delete_own_organization"
on ssbj_report_time_horizons
for delete
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- GRANT: レポート・組織は作成時にだけ指定できる（作成後に別のレポートへ付け替えない）。
grant select, delete on ssbj_report_time_horizons to authenticated;
grant insert (
  "reportId",
  "organizationId",
  "shortTermState",
  "shortTerm",
  "mediumTermState",
  "mediumTerm",
  "longTermState",
  "longTerm",
  "planningHorizonRelationState",
  "planningHorizonRelation",
  "internalNote"
) on ssbj_report_time_horizons to authenticated;
grant update (
  "shortTermState",
  "shortTerm",
  "mediumTermState",
  "mediumTerm",
  "longTermState",
  "longTerm",
  "planningHorizonRelationState",
  "planningHorizonRelation",
  "internalNote"
) on ssbj_report_time_horizons to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。

-- 保存版セクション。行が無いレポートでも、すべて未入力の定義として取り込む（欠落と未入力を区別するため）。
create function ssbj_snapshot_section__time_horizons(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'shortTerm', ssbj_field_value_json(th."shortTermState", th."shortTerm"),
    'mediumTerm', ssbj_field_value_json(th."mediumTermState", th."mediumTerm"),
    'longTerm', ssbj_field_value_json(th."longTermState", th."longTerm"),
    'planningHorizonRelation',
      ssbj_field_value_json(th."planningHorizonRelationState", th."planningHorizonRelation"),
    'internalNote', th."internalNote"
  )
  from (select 1) as one
  left join ssbj_report_time_horizons th on th."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__time_horizons(uuid) is
  '保存版の sections.time_horizons。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__time_horizons(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__time_horizons(uuid) to service_role;
