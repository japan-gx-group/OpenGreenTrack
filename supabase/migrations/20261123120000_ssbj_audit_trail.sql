-- SSBJ レポート: 開示値から活動量・係数・根拠文書までをたどれる「証跡一式」の出力（docs/ssbj-spec.md §13「証跡一式の出力（R2-33）」）。
--
-- §1 ssbj_audit_trail_details: レポートの年度の算定明細（活動量・適用した係数・排出量・Scope 2 の基準別・帳票）、Scope 3 の
--    直接入力の値、使った係数を、numeric を text にして返す（docs/ssbj-spec.md §6）。返すのは合計に入る明細だけで、範囲は
--    dashboard_aggregates（refresh_dashboard_aggregates）・dashboard_scope3_category_emissions と同じ（年度帰属は periodStart、
--    Scope 3 は方式ごとの採用値）。画面は、出力する明細の行を足し上げて保存版の開示値と突き合わせ、一致しないときは知らせる
--    （保存版を作った後に OGT の算定が変わった）。
-- §2 record_ssbj_export を置き換え、出力形式に 'trail_xlsx' を加える（20261123100000_ssbj_record_print.sql の定義に足しただけ）。

-- §1 証跡の明細

create function ssbj_audit_trail_details(p_fiscal_year_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fy as (
    select f.id, f."organizationId", f."startDate", f."endDate"
    from fiscal_years f
    where f.id = p_fiscal_year_id
  ),
  methods as (
    select cat.category_id, coalesce(m.method, 'direct'::"Scope3Method") as method
    from generate_series(1, 15) as cat(category_id)
    cross join fy
    left join scope3_category_methods m
      on m."organizationId" = fy."organizationId"
     and m."fiscalYearId" = fy.id
     and m."categoryId" = cat.category_id
  ),
  -- 年度帰属は periodStart 基準（refresh_dashboard_aggregates と同じ）。Scope 3 は方式が積上げのカテゴリだけが合計に入る。
  results as (
    select er.*, ar."locationId" as record_location_id, ar."sourceType", ar."energyType", ar.amount, ar.unit,
           ar."periodStart", ar."periodEnd", ar.note
    from emission_results er
    join activity_records ar on ar.id = er."activityRecordId"
    cross join fy
    where ar."organizationId" = fy."organizationId"
      and ar."periodStart" between fy."startDate" and fy."endDate"
  ),
  counted as (
    select r.* from results r
    where r.scope in ('scope1', 'scope2')
       or (r.scope = 'scope3' and r."categoryId" between 1 and 15
           and exists (select 1 from methods m where m.category_id = r."categoryId" and m.method = 'calculated'))
  ),
  direct_rows as (
    select e.*
    from scope3_category_emissions e
    cross join fy
    where e."organizationId" = fy."organizationId"
      and e."fiscalYearId" = fy.id
      and exists (select 1 from methods m where m.category_id = e."categoryId" and m.method = 'direct')
  ),
  basis as (
    select sbr.*
    from scope2_basis_results sbr
    join counted c on c."activityRecordId" = sbr."activityRecordId" and c.scope = 'scope2'
  ),
  factor_ids as (
    select "emissionFactorId" as id from counted where "emissionFactorId" is not null
    union
    select "emissionFactorId" from basis where "emissionFactorId" is not null
  )
  select case when not exists (select 1 from fy) then null else jsonb_build_object(
    'details', coalesce((
      select jsonb_agg(jsonb_build_object(
        'activityRecordId', c."activityRecordId",
        'locationName', l.name,
        'sourceType', c."sourceType",
        'energyType', c."energyType",
        'amount', c.amount::text,
        'unit', c.unit,
        'periodStart', c."periodStart",
        'periodEnd', c."periodEnd",
        'note', c.note,
        'scope', c.scope,
        'categoryId', c."categoryId",
        'emissions', c.emissions::text,
        'emissionFactorId', c."emissionFactorId",
        'appliedFactorName', c."appliedFactorName",
        'appliedFactorValue', c."appliedFactorValue"::text,
        'appliedFactorUnit', c."appliedFactorUnit",
        'calculatedAt', c."calculatedAt",
        'basis', coalesce((
          select jsonb_agg(jsonb_build_object(
            'basis', b.basis, 'evidence', b.evidence, 'emissions', b.emissions::text,
            'emissionFactorId', b."emissionFactorId", 'appliedFactorName', b."appliedFactorName",
            'appliedFactorValue', b."appliedFactorValue"::text, 'appliedFactorUnit', b."appliedFactorUnit"
          ) order by b.basis)
          from basis b where b."activityRecordId" = c."activityRecordId"
        ), '[]'::jsonb),
        'evidenceFiles', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'fileName', f."fileName", 'sha256', f.sha256) order by f."fileName", f.id)
          from activity_record_evidence are
          join activity_evidence_files f on f.id = are."evidenceFileId"
          where are."activityRecordId" = c."activityRecordId"
        ), '[]'::jsonb)
      ) order by c.scope, c."categoryId" nulls first, c."periodStart", l.name, c."activityRecordId")
      from counted c
      left join locations l on l.id = c.record_location_id
    ), '[]'::jsonb),
    'scope3Direct', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'categoryId', d."categoryId", 'emissions', d.emissions::text,
        'periodStart', d."periodStart", 'periodEnd', d."periodEnd", 'dataSourceNote', d."dataSourceNote",
        'updatedAt', d."updatedAt"
      ) order by d."categoryId", d.id)
      from direct_rows d
    ), '[]'::jsonb),
    'factors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ef.id, 'name', ef.name, 'energyType', ef."energyType", 'scope', ef.scope,
        'factorValue', ef."factorValue"::text, 'unit', ef.unit, 'applicableYear', ef."applicableYear",
        'regionName', ef."regionName", 'source', ef.source, 'status', ef.status, 'isCustom', ef."isCustom",
        'factorType', ef."factorType", 'effectiveFrom', ef."effectiveFrom", 'effectiveTo', ef."effectiveTo",
        'sourceDocumentName', ef."sourceDocumentName", 'sourceUrl', ef."sourceUrl",
        'providerName', ef."providerName", 'menuName', ef."menuName"
      ) order by ef.scope, ef.name, ef.id)
      from emission_factors ef
      where ef.id in (select id from factor_ids)
    ), '[]'::jsonb)
  ) end;
$$;

comment on function ssbj_audit_trail_details(uuid) is
  'SSBJ の証跡一式の出力用に、年度の算定明細（合計に入るものだけ）・Scope 3 の直接入力・使った係数を十進文字列で返す。'
  'security invoker により組織 RLS を適用する。年度が見えなければ null。';

revoke execute on function ssbj_audit_trail_details(uuid) from public, anon;
grant execute on function ssbj_audit_trail_details(uuid) to authenticated, service_role;

-- §2 出力の記録（20261123100000_ssbj_record_print.sql の定義に 'trail_xlsx' を足した）

create or replace function record_ssbj_export(p_report_id uuid, p_format text, p_version_id uuid default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_version_number integer;
  v_id bigint;
begin
  if p_format not in ('csv', 'xlsx', 'audit_csv', 'audit_xlsx', 'print', 'trail_xlsx') then
    raise exception '出力形式が不正です: %', p_format using errcode = 'P2061';
  end if;

  select r."organizationId" into v_organization_id
  from public.ssbj_reports r
  where r.id = p_report_id
    and r."organizationId" = public.current_user_organization_id();
  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;

  if p_version_id is not null then
    select v."versionNumber" into v_version_number
    from public.ssbj_report_versions v
    where v.id = p_version_id and v."reportId" = p_report_id;
    if not found then
      raise exception '保存版が見つかりません: %', p_version_id using errcode = 'P2031';
    end if;
  end if;

  -- 閲覧者は、承認済みのレポートの承認した保存版の CSV / Excel / 印刷だけ（作業中・未承認の版・操作履歴は見えないため）。
  -- 証跡一式（trail_xlsx）は算定明細と操作履歴を含むため、閲覧者には記録させない（= 出力させない）。
  if not public.ssbj_current_user_can_view_working() and (
    p_format not in ('csv', 'xlsx', 'print')
    or p_version_id is null
    or not exists (
      select 1 from public.ssbj_reports r
      where r.id = p_report_id and r.status = 'approved' and r."approvedVersionId" = p_version_id
    )
  ) then
    raise exception '保存版が見つかりません: %', coalesce(p_version_id::text, p_report_id::text) using errcode = 'P2031';
  end if;

  insert into public.ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", details)
  values
    (v_organization_id, p_report_id, auth.uid(), 'export',
     case when p_version_id is null then 'report' else 'version' end,
     coalesce(p_version_id::text, p_report_id::text),
     jsonb_strip_nulls(jsonb_build_object('format', p_format, 'versionNumber', v_version_number)))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function record_ssbj_export(uuid, text, uuid) is
  'SSBJ のファイル出力（CSV / Excel / 操作履歴の出力 / 印刷・PDF 保存 / 証跡一式）を操作履歴に記録する。自組織のレポートだけ。'
  '閲覧者は承認した版の CSV / Excel / 印刷だけ。印刷は「印刷・PDFとして保存」を選んだ時点の記録で、実際に印刷したかは区別できない。'
  'P2031 = レポート・版が無い（見えない）、P2061 = 形式が不正。';

revoke execute on function record_ssbj_export(uuid, text, uuid) from public, anon;
grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;
