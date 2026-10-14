-- SSBJ 開示レポート（R2）: 外部で算定した排出量（外部算定値。docs/ssbj-spec.md §13「外部で算定した排出量」）。
--
-- OGT が算定できるのは今のところ実質 CO2 だけで、対応する排出源も限られる。企業が別の方法で算定済みの値
-- （コンサルタントの算定、他のシステム、子会社から届いた値など）を、出典（算定した者・方法・根拠文書）と
-- 確認者を付けてレポートに使えるようにする。§10 の登録規約 1〜8 に従う（RLS、版数、保存版、操作履歴、承認ロック、復元）。
-- 書き込みは SSBJ の入力担当か管理者だけ（20261010120000_ssbj_role_policies.sql と同じ形の RESTRICTIVE のポリシー）。
--
-- 二重計上の防止（OGT の採用値と外部算定値の両方から同じものを採用しない）:
--   - OGT の採用値は実質 CO2 だけ（公式係数）。Scope 2 は基準不明（ロケーション基準・マーケット基準のどちらでもない）。
--   - 外部算定値が OGT の採用値と重なるのは、Scope 1・Scope 3（同じカテゴリ）で、同じ区分の OGT の値が算定済みで、
--     外部算定値の対象ガスに CO2 を含むとき（P2071）。CO2 以外のガスだけの外部算定値は、OGT の値を補う。
--   - Scope 2 の外部算定値は基準（ロケーション基準・マーケット基準）ごとの値で、OGT の基準不明の値とは別の値として
--     示す（足し合わせない）。OGT からは基準別の値が得られないため、ここを止めると基準別の値を入れる手段が無くなる。
--   - 外部算定値どうしが重なるのは、同じ Scope・カテゴリ・基準で、対象ガスが重なるとき（P2072）。
--   - 確かめるのはトランザクションの最後（遅延の制約トリガー）。版の復元がセクションを順に入れ替える途中の状態では止めない。

-- §1 テーブル

create table ssbj_external_emissions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  scope smallint not null,
  -- Scope 3 のときだけ必須（1〜15）。
  "scope3CategoryId" smallint,
  -- Scope 2 のときだけ必須。location = ロケーション基準、market = マーケット基準。
  "scope2Basis" varchar(20),
  -- 対象ガス（京都議定書の 7 種類から 1 つ以上）。
  gases varchar(10)[] not null,
  -- 排出量（t-CO2e）。保存版・画面では十進表記の文字列で受け渡す（§6）。
  value numeric not null,
  unit varchar(20) not null default 't-CO2e',
  "periodStart" date not null,
  "periodEnd" date not null,
  -- 出典: 算定した者（会社・部署・システム）と算定方法。
  "calculatedBy" text not null,
  "calculationMethod" text not null,
  -- 根拠文書（同じレポートの ssbj_evidence）。版の復元が根拠文書と外部算定値を入れ替える途中でも止めないよう、確かめるのはトランザクションの最後。
  "evidenceId" uuid not null references ssbj_evidence(id) deferrable initially deferred,
  -- 確認者（同じ組織の利用者）と確認日時。
  "confirmedByUserId" uuid not null,
  "confirmedAt" timestamptz not null,
  -- 内部メモ（開示しない。§5）。
  "internalNote" text,
  "createdByUserId" uuid,
  "updatedByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  constraint ssbj_external_emissions_scope_check check (scope in (1, 2, 3)),
  -- NULL を「違反ではない」と扱わないよう、必須の側は is not null を明示する（CHECK は NULL の結果を通してしまう）。
  constraint ssbj_external_emissions_category_check check (
    (scope = 3 and "scope3CategoryId" is not null and "scope3CategoryId" between 1 and 15)
    or (scope <> 3 and "scope3CategoryId" is null)
  ),
  constraint ssbj_external_emissions_basis_check check (
    (scope = 2 and "scope2Basis" is not null and "scope2Basis" in ('location', 'market'))
    or (scope <> 2 and "scope2Basis" is null)
  ),
  constraint ssbj_external_emissions_gases_check check (
    cardinality(gases) > 0 and gases <@ array['CO2', 'CH4', 'N2O', 'HFCs', 'PFCs', 'SF6', 'NF3']::varchar(10)[]
  ),
  constraint ssbj_external_emissions_value_check check (value >= 0),
  constraint ssbj_external_emissions_unit_check check (unit = 't-CO2e'),
  constraint ssbj_external_emissions_period_check check ("periodEnd" >= "periodStart"),
  constraint ssbj_external_emissions_calculated_by_not_blank check (btrim("calculatedBy") <> ''),
  constraint ssbj_external_emissions_method_not_blank check (btrim("calculationMethod") <> '')
);

comment on table ssbj_external_emissions is
  'SSBJ レポートに採用した、外部で算定した排出量（作業中データ）。出典（算定した者・方法・根拠文書）と確認者を必ず持つ。'
  'OGT の採用値と同じものは採用できない（P2071）。保存版には ssbj_snapshot_section__external_emissions で取り込む。';
comment on column ssbj_external_emissions.gases is '対象ガス（CO2 / CH4 / N2O / HFCs / PFCs / SF6 / NF3 から 1 つ以上）。';
comment on column ssbj_external_emissions."internalNote" is '内部メモ。開示しない（§5）。';

create index ssbj_external_emissions_report_idx on ssbj_external_emissions ("reportId", scope, "scope3CategoryId");
create index ssbj_external_emissions_evidence_idx on ssbj_external_emissions ("evidenceId");

-- §2 トリガー（§10 の手順 2・6・7）

create trigger set_ssbj_external_emissions_actor
before insert or update on ssbj_external_emissions
for each row execute function set_row_actor();

create trigger set_ssbj_external_emissions_updated_at
before update on ssbj_external_emissions
for each row execute function set_updated_at();

create trigger bump_ssbj_external_emissions_draft_revision
after insert or update or delete on ssbj_external_emissions
for each row execute function bump_ssbj_draft_revision();

create trigger audit_ssbj_external_emissions
after insert or update or delete on ssbj_external_emissions
for each row execute function ssbj_audit_row_change('external_emission', 'id', 'calculatedBy');

create trigger reject_ssbj_external_emissions_when_approved
before insert or update or delete on ssbj_external_emissions
for each row execute function reject_ssbj_change_when_approved();

-- §3 二重計上の防止
-- 戻り値: 'ogt'（OGT の採用値と重なる）/ 'external'（ほかの外部算定値と重なる）/ null（重ならない）。

create function ssbj_external_emission_overlap(
  p_report_id uuid, p_id uuid, p_scope smallint, p_category smallint, p_basis text, p_gases varchar(10)[]
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_scope <> 2 and 'CO2' = any (p_gases) and exists (
      select 1
      from public.ssbj_ogt_adoptions a
      cross join lateral jsonb_array_elements(a."adoptedValues") as v(value)
      where a."reportId" = p_report_id
        and (v.value ->> 'scope')::smallint = p_scope
        and (v.value ->> 'scope3CategoryId')::smallint is not distinct from p_category
        and v.value -> 'value' ->> 'state' = 'answered'
    ) then 'ogt'
    when exists (
      select 1
      from public.ssbj_external_emissions e
      where e."reportId" = p_report_id
        and e.id <> p_id
        and e.scope = p_scope
        and e."scope3CategoryId" is not distinct from p_category
        and e."scope2Basis" is not distinct from p_basis
        and e.gases && p_gases
    ) then 'external'
  end;
$$;

comment on function ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[]) is
  '外部算定値が OGT の採用値（ogt）・ほかの外部算定値（external）と重なるか。重ならなければ null。';

revoke execute on function ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[]) from public, anon, authenticated;
grant execute on function ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[]) to service_role;

-- 外部算定値を書いたとき（トランザクションの最後に、確定した内容で調べる。その後に消えた行は調べない）。
create function ssbj_check_external_emission_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ssbj_external_emissions%rowtype;
  v_overlap text;
begin
  select * into v_row from public.ssbj_external_emissions e where e.id = new.id;
  if not found then
    return null;
  end if;
  v_overlap := public.ssbj_external_emission_overlap(
    v_row."reportId", v_row.id, v_row.scope, v_row."scope3CategoryId", v_row."scope2Basis", v_row.gases
  );
  if v_overlap = 'ogt' then
    raise exception 'この Scope・カテゴリの CO2 は、OGT の採用値に含まれています。二重に計上しないよう、対象ガスから CO2 を外すか、OGT の採用を見直してください'
      using errcode = 'P2071';
  elsif v_overlap = 'external' then
    raise exception '同じ Scope・カテゴリ・基準で、同じガスの外部算定値がすでにあります。二重に計上しないよう、どちらかを直してください'
      using errcode = 'P2072';
  end if;
  return null;
end;
$$;

create constraint trigger check_ssbj_external_emissions_overlap
after insert or update on ssbj_external_emissions
deferrable initially deferred
for each row execute function ssbj_check_external_emission_overlap();

-- OGT の値を採用したとき（採用は service_role の RPC。外部算定値と重なる値は採用させない）。
create function ssbj_check_ogt_adoption_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ssbj_ogt_adoptions a where a.id = new.id) then
    return null;
  end if;
  if exists (
    select 1 from public.ssbj_external_emissions e
    where e."reportId" = new."reportId"
      and public.ssbj_external_emission_overlap(
        e."reportId", e.id, e.scope, e."scope3CategoryId", e."scope2Basis", e.gases
      ) = 'ogt'
  ) then
    raise exception 'OGT の値を採用すると、CO2 を含む外部算定値（同じ Scope・カテゴリ）と二重に計上されます。外部算定値を見直してから採用してください'
      using errcode = 'P2071';
  end if;
  return null;
end;
$$;

create constraint trigger check_ssbj_ogt_adoptions_overlap
after insert or update on ssbj_ogt_adoptions
deferrable initially deferred
for each row execute function ssbj_check_ogt_adoption_overlap();

-- §4 RLS と権限（§10 の手順 1。書き込みは SSBJ の入力担当か管理者、閲覧は閲覧者以外）
-- 根拠文書は同じレポートのもの、確認者は同じ組織の利用者に限る。

alter table ssbj_external_emissions enable row level security;

create policy "ssbj_external_emissions_select_own_organization"
on ssbj_external_emissions for select to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_external_emissions_insert_own_organization"
on ssbj_external_emissions for insert to authenticated
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId" and r."organizationId" = (select current_user_organization_id())
  )
  and exists (
    select 1 from ssbj_evidence ev
    where ev.id = "evidenceId" and ev."reportId" = ssbj_external_emissions."reportId"
  )
  and exists (
    select 1 from profiles p
    where p.id = "confirmedByUserId" and p."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_external_emissions_update_own_organization"
on ssbj_external_emissions for update to authenticated
using ("organizationId" = (select current_user_organization_id()))
with check (
  "organizationId" = (select current_user_organization_id())
  and exists (
    select 1 from ssbj_reports r
    where r.id = "reportId" and r."organizationId" = (select current_user_organization_id())
  )
  and exists (
    select 1 from ssbj_evidence ev
    where ev.id = "evidenceId" and ev."reportId" = ssbj_external_emissions."reportId"
  )
  and exists (
    select 1 from profiles p
    where p.id = "confirmedByUserId" and p."organizationId" = (select current_user_organization_id())
  )
);

create policy "ssbj_external_emissions_delete_own_organization"
on ssbj_external_emissions for delete to authenticated
using ("organizationId" = (select current_user_organization_id()));

create policy "ssbj_external_emissions_insert_requires_ssbj_editor" on ssbj_external_emissions
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_external_emissions_update_requires_ssbj_editor" on ssbj_external_emissions
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_external_emissions_delete_requires_ssbj_editor" on ssbj_external_emissions
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));
create policy "ssbj_external_emissions_select_requires_working_access" on ssbj_external_emissions
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));

grant select, delete on ssbj_external_emissions to authenticated;
grant insert (
  "organizationId", "reportId", scope, "scope3CategoryId", "scope2Basis", gases, value, unit, "periodStart", "periodEnd",
  "calculatedBy", "calculationMethod", "evidenceId", "confirmedByUserId", "confirmedAt", "internalNote"
) on ssbj_external_emissions to authenticated;
grant update (
  scope, "scope3CategoryId", "scope2Basis", gases, value, unit, "periodStart", "periodEnd",
  "calculatedBy", "calculationMethod", "evidenceId", "confirmedByUserId", "confirmedAt", "internalNote"
) on ssbj_external_emissions to authenticated;

-- §5 保存版（§10 の手順 3）と復元（手順 8）
-- 保存版には、根拠文書の資料名と確認者の名前も残す（その時点の表示を再現するため。復元では使わない）。

create function ssbj_snapshot_section__external_emissions(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'scope', e.scope,
        'scope3CategoryId', e."scope3CategoryId",
        'scope2Basis', e."scope2Basis",
        'gases', to_jsonb(e.gases),
        'value', e.value::text,
        'unit', e.unit,
        'period', jsonb_build_object('startDate', e."periodStart", 'endDate', e."periodEnd"),
        'calculatedBy', e."calculatedBy",
        'calculationMethod', e."calculationMethod",
        'evidenceId', e."evidenceId",
        'evidenceTitle', ev."documentTitle",
        'confirmedByUserId', e."confirmedByUserId",
        'confirmedByName', coalesce(p."fullName", p.email),
        'confirmedAt', e."confirmedAt",
        'internalNote', e."internalNote"
      ) order by e.scope, e."scope3CategoryId" nulls first, e."scope2Basis" nulls first, e."createdAt", e.id
    ),
    '[]'::jsonb
  )
  from ssbj_external_emissions e
  left join ssbj_evidence ev on ev.id = e."evidenceId"
  left join profiles p on p.id = e."confirmedByUserId"
  where e."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__external_emissions(uuid) is
  '保存版の sections.external_emissions。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

create function ssbj_restore_section__external_emissions(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_external_emissions where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'array' then
    return;
  end if;
  insert into ssbj_external_emissions
    (id, "organizationId", "reportId", scope, "scope3CategoryId", "scope2Basis", gases, value, unit,
     "periodStart", "periodEnd", "calculatedBy", "calculationMethod", "evidenceId", "confirmedByUserId", "confirmedAt",
     "internalNote", "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
  select
    (e.value ->> 'id')::uuid, p_organization_id, p_report_id, (e.value ->> 'scope')::smallint,
    (e.value ->> 'scope3CategoryId')::smallint, e.value ->> 'scope2Basis',
    array(select jsonb_array_elements_text(e.value -> 'gases'))::varchar(10)[],
    (e.value ->> 'value')::numeric, e.value ->> 'unit',
    (e.value -> 'period' ->> 'startDate')::date, (e.value -> 'period' ->> 'endDate')::date,
    e.value ->> 'calculatedBy', e.value ->> 'calculationMethod', (e.value ->> 'evidenceId')::uuid,
    (e.value ->> 'confirmedByUserId')::uuid, (e.value ->> 'confirmedAt')::timestamptz, e.value ->> 'internalNote',
    p_actor_user_id, p_actor_user_id,
    now() + make_interval(secs => e.ordinality / 1000.0), now() + make_interval(secs => e.ordinality / 1000.0)
  from jsonb_array_elements(p_section) with ordinality as e(value, ordinality);
end;
$$;

comment on function ssbj_restore_section__external_emissions(uuid, uuid, uuid, jsonb) is
  '保存版の sections.external_emissions を作業中データに戻す（restore_ssbj_report_version が呼ぶ）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__external_emissions(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__external_emissions(uuid) to service_role;
revoke execute on function ssbj_restore_section__external_emissions(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function ssbj_restore_section__external_emissions(uuid, uuid, uuid, jsonb) to service_role;
