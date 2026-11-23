-- SSBJ レポート: OGT の削減目標を、OGT の値と一緒にレポートに採用する（docs/ssbj-spec.md §13「OGT の値の採用（T08b）」の「R2 の追加（削減目標の採用。R2-32）」）。
--
-- OGT の削減目標は「基準年度（reduction_targets）+ 年度ごとの削減率（reduction_target_years）」で持ち、基準年度の実績は
-- 表示のたびに引き直す（docs/functional-spec.md §4.7）。開示に使うには、採用した時点の値を固定する必要がある。
-- そこで OGT の値の採用（ssbj_ogt_adoptions。T08b）と同じ行に、採用した時点の削減目標を複写して持つ。
-- Scope 1・2・3 の合計と同じ時点の値にそろえるため、OGT の値と分けては採用しない（採用し直すと両方を置き換える）。
--
-- 改ざん防止は T08b と同じ: 書き込みは、サーバが OGT から取り直した値を渡す service_role 限定の adopt_ssbj_ogt_values だけ。

-- §1 列

alter table ssbj_ogt_adoptions add column "reductionTarget" jsonb;

alter table ssbj_ogt_adoptions add constraint ssbj_ogt_adoptions_reduction_target_shape check (
  "reductionTarget" is null
  or (jsonb_typeof("reductionTarget") = 'object' and "reductionTarget" ->> 'status' in ('set', 'not_set'))
);

comment on column ssbj_ogt_adoptions."reductionTarget" is
  'SsbjReductionTargetAdoption（src/features/ssbj/types.ts）。採用した時点の OGT の削減目標。status = not_set は OGT に目標が無い。'
  'null はこの列を足す前に採用した行（削減目標を採用していない）。OGT の目標が変わっても書き換えない。';

-- §2 OGT の削減目標の読み取り（画面とサーバが、採用する前に読む。数値は numeric を text にして返す: docs/ssbj-spec.md §6）
--
-- 基準年度・レポートの年度の排出量は dashboard_aggregates（算定確定時の値）の Scope 1・2・3 の合計。集計行が無い年度は null
-- （未算定）にする。OGT のダッシュボードは集計行が無い年度を算定結果の合算で補うが、開示に使う値は確定した集計だけにする。
-- 年度の目標排出量は「基準年度の排出量 × (1 − 削減率 / 100)」を numeric のまま計算する（丸めない）。基準年度に正の実績が
-- 無い（集計行が無い・算定データが消えて集計が 0 になった）ときは、削減率は返し、目標排出量は null（算定できない）にする
-- （0 を基準にすると目標も 0 になり、実績がすべて超過に見えるため）。基準年度に正の実績があり削減率が 100% なら目標は 0。
-- レポートの年度の実績は、Scope 別の候補値がすべて未算定なら集計行があっても未算定にする（画面・サーバ側で判定する:
-- src/features/ssbj/utils/reductionTarget.ts）。
-- security invoker のため組織の RLS が効く。基準年度の行が見えない（他組織・削除済み）ときは目標が無いものとする。

create function ssbj_ogt_reduction_target(p_fiscal_year_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with report_year as (
    select fy.id, fy."startDate", fy."organizationId"
    from fiscal_years fy
    where fy.id = p_fiscal_year_id
  ),
  target as (
    select rt."organizationId", base.id, base.label, base."startDate", base."endDate"
    from report_year ry
    join reduction_targets rt on rt."organizationId" = ry."organizationId"
    join fiscal_years base on base.id = rt."baseFiscalYearId" and base."organizationId" = ry."organizationId"
  ),
  base_total as (
    select (da."scope1Total" + da."scope2Total" + da."scope3Total") as total
    from target t
    join dashboard_aggregates da on da."fiscalYearId" = t.id and da."organizationId" = t."organizationId"
  ),
  report_total as (
    select (da."scope1Total" + da."scope2Total" + da."scope3Total") as total
    from report_year ry
    join dashboard_aggregates da on da."fiscalYearId" = ry.id and da."organizationId" = ry."organizationId"
  )
  select case
    when not exists (select 1 from report_year) then null
    when not exists (select 1 from target) then jsonb_build_object('status', 'not_set')
    else (
      select jsonb_build_object(
        'status', 'set',
        'baseFiscalYear', jsonb_build_object(
          'id', t.id, 'label', t.label, 'startDate', t."startDate", 'endDate', t."endDate"),
        -- 日本時間の今日より前に終わった年度か。終わっていなければ、基準年度の排出量は期中の累計（月々の入力で増える）。
        'baseYearEnded', t."endDate" < (now() at time zone 'Asia/Tokyo')::date,
        'baseYearEmissions', (select trim_scale(b.total)::text from base_total b),
        'reportFiscalYearId', ry.id,
        'reportYear', extract(year from ry."startDate")::integer,
        'reportYearEmissions', (select trim_scale(r.total)::text from report_total r),
        'targetYears', coalesce((
          select jsonb_agg(jsonb_build_object(
            'targetYear', y."targetYear",
            'reductionPercent', trim_scale(y."reductionPercent")::text,
            'targetEmissions', (
              select trim_scale(b.total * (100 - y."reductionPercent") / 100)::text
              from base_total b where b.total > 0
            )
          ) order by y."targetYear")
          from reduction_target_years y
          where y."organizationId" = t."organizationId"
        ), '[]'::jsonb)
      )
      from target t, report_year ry
    )
  end;
$$;

comment on function ssbj_ogt_reduction_target(uuid) is
  'SSBJ の目標の採用用に、OGT の削減目標と基準年度・レポートの年度の排出量（dashboard_aggregates の合計）を十進文字列で返す。'
  'security invoker により組織 RLS を適用する。年度が見えなければ null、目標が無ければ status = not_set。';

revoke execute on function ssbj_ogt_reduction_target(uuid) from public, anon;
grant execute on function ssbj_ogt_reduction_target(uuid) to authenticated, service_role;

-- §3 採用 RPC（20261009090000_ssbj_report_write_lock.sql の定義に、削減目標の引数を足した）
-- 引数が増えるため、古い形の関数は消す（同じ名前の関数を 2 つ残さない）。

drop function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb);

create function adopt_ssbj_ogt_values(
  p_report_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_candidates jsonb,
  p_supplier_references jsonb,
  p_reduction_target jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fiscal_year_id uuid;
  v_adopted_at timestamptz := now();
  v_adopted_values jsonb;
begin
  select "fiscalYearId" into v_fiscal_year_id
  from ssbj_reports
  where id = p_report_id
    and "organizationId" = p_organization_id;

  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id
      using errcode = 'P2041';
  end if;

  perform lock_ssbj_report_working_rows(p_report_id);

  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) = 0
     or jsonb_typeof(p_supplier_references) <> 'array' then
    raise exception '採用する候補値の形式が正しくありません'
      using errcode = 'P2042';
  end if;

  -- 候補値・参考値がすべてレポートの年度のものであること（別の年度の値を採用させない）。
  if exists (
    select 1 from jsonb_array_elements(p_candidates || p_supplier_references) as item(value)
    where item.value ->> 'fiscalYearId' is distinct from v_fiscal_year_id::text
  ) then
    raise exception '候補値の年度がレポートの年度と一致しません'
      using errcode = 'P2042';
  end if;

  -- 削減目標は必ず渡す（目標が無ければ status = not_set）。目標があるときは、レポートの年度について読んだものであること。
  if p_reduction_target is null or jsonb_typeof(p_reduction_target) <> 'object'
     or p_reduction_target ->> 'status' not in ('set', 'not_set')
     or (p_reduction_target ->> 'status' = 'set'
         and p_reduction_target -> 'reportYear' ->> 'fiscalYearId' is distinct from v_fiscal_year_id::text) then
    raise exception '採用する削減目標の形式が正しくありません'
      using errcode = 'P2042';
  end if;

  select jsonb_agg(
    item.value || jsonb_build_object('adoptedAt', v_adopted_at, 'adoptedBy', p_actor_user_id)
    order by item.ordinality
  )
  into v_adopted_values
  from jsonb_array_elements(p_candidates) with ordinality as item(value, ordinality);

  insert into ssbj_ogt_adoptions
    ("organizationId", "reportId", "adoptedValues", "supplierReferences", "reductionTarget", "adoptedAt", "adoptedByUserId")
  values
    (p_organization_id, p_report_id, v_adopted_values, p_supplier_references, p_reduction_target, v_adopted_at, p_actor_user_id)
  on conflict ("reportId") do update set
    "adoptedValues" = excluded."adoptedValues",
    "supplierReferences" = excluded."supplierReferences",
    "reductionTarget" = excluded."reductionTarget",
    "adoptedAt" = excluded."adoptedAt",
    "adoptedByUserId" = excluded."adoptedByUserId";

  return jsonb_build_object('adoptedAt', v_adopted_at);
end;
$$;

comment on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb, jsonb) is
  'サーバが OGT から取り直した候補値と削減目標をレポートに採用する（採用し直すと置き換える）。service_role 限定。'
  'P2041 = レポートが無い・組織不一致、P2042 = 候補値・削減目標の形式・年度が不正。';

revoke execute on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;

-- §4 保存版セクション（20260929180243_ssbj_ogt_adoptions.sql の定義に reductionTarget を足した）
-- この列を足す前に採用した行（null）は、キーを出さない（読む側は「この採用には削減目標が含まれていない」と扱う）。

create or replace function ssbj_snapshot_section__ghg(p_report_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'adoptedAt', a."adoptedAt",
    'adoptedBy', a."adoptedByUserId",
    'values', a."adoptedValues",
    'supplierReferences', a."supplierReferences"
  ) || case when a."reductionTarget" is null then '{}'::jsonb
            else jsonb_build_object('reductionTarget', a."reductionTarget") end
  from ssbj_ogt_adoptions a
  where a."reportId" = p_report_id;
$$;

comment on function ssbj_snapshot_section__ghg(uuid) is
  '保存版の sections.ghg。create_ssbj_report_version が自動収集する（docs/ssbj-spec.md §10）。service_role 限定。';

revoke execute on function ssbj_snapshot_section__ghg(uuid) from public, anon, authenticated;
grant execute on function ssbj_snapshot_section__ghg(uuid) to service_role;

-- §5 復元（20261002090200_ssbj_restore_version.sql の定義に reductionTarget を足した）

create or replace function ssbj_restore_section__ghg(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_ogt_adoptions where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'object' then
    return;
  end if;
  -- 採用した値・削減目標・採用日時・採用者は、版に残っているものをそのまま戻す（OGT の最新値を取り直さない）。
  insert into ssbj_ogt_adoptions
    ("organizationId", "reportId", "adoptedValues", "supplierReferences", "reductionTarget", "adoptedAt", "adoptedByUserId")
  values
    (p_organization_id, p_report_id, p_section -> 'values', coalesce(p_section -> 'supplierReferences', '[]'::jsonb),
     p_section -> 'reductionTarget',
     (p_section ->> 'adoptedAt')::timestamptz, (p_section ->> 'adoptedBy')::uuid);
end;
$$;

revoke execute on function ssbj_restore_section__ghg(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function ssbj_restore_section__ghg(uuid, uuid, uuid, jsonb) to service_role;
