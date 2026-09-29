-- SSBJ の参照画面へ、numeric を JavaScript の number に変換せず十進文字列で渡す。
-- 候補値の正本は既存の dashboard_aggregates / dashboard_scope3_category_emissions。
create function ssbj_ogt_numeric_values(p_fiscal_year_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fy as (
    select id, "organizationId", "startDate", "endDate"
    from fiscal_years
    where id = p_fiscal_year_id
  ),
  scope2_parts as (
    select
      count(*) as result_count,
      coalesce(sum(er.emissions) filter (where ef."factorType" = 'basic'), 0)::text as basic,
      coalesce(sum(er.emissions) filter (where ef."factorType" = 'adjusted'), 0)::text as adjusted,
      coalesce(sum(er.emissions) filter (where ef."factorType" is null), 0)::text as unclassified
    from fy
    join activity_records ar
      on ar."organizationId" = fy."organizationId"
     and ar."periodStart" between fy."startDate" and fy."endDate"
    join emission_results er on er."activityRecordId" = ar.id and er.scope = 'scope2'
    left join emission_factors ef on ef.id = er."emissionFactorId"
  )
  select jsonb_build_object(
    'aggregate', (
      select jsonb_build_object(
        'scope1', da."scope1Total"::text,
        'scope2', da."scope2Total"::text,
        'scope3', da."scope3Total"::text,
        'updatedAt', da."updatedAt"
      )
      from dashboard_aggregates da
      where da."fiscalYearId" = fy.id and da."organizationId" = fy."organizationId"
    ),
    'scope2Breakdown', (
      select case when result_count = 0 then null else jsonb_build_object(
        'basic', basic, 'adjusted', adjusted, 'unclassified', unclassified
      ) end from scope2_parts
    ),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('categoryId', c."categoryId", 'emissions', c.emissions::text)
                       order by c."categoryId")
      from dashboard_scope3_category_emissions(fy.id) c
    ), '[]'::jsonb),
    'suppliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'categoryId', se."categoryId",
        'supplierId', se."supplierId", 'supplierName', s.name,
        'emissions', se.emissions::text) order by se."categoryId", s.name, se.id)
      from supplier_emissions se
      join suppliers s on s.id = se."supplierId" and s."organizationId" = fy."organizationId"
      where se."fiscalYearId" = fy.id and se."organizationId" = fy."organizationId"
    ), '[]'::jsonb)
  )
  from fy;
$$;

revoke execute on function ssbj_ogt_numeric_values(uuid) from public, anon;
grant execute on function ssbj_ogt_numeric_values(uuid) to authenticated, service_role;

comment on function ssbj_ogt_numeric_values(uuid) is
  'SSBJ 候補値用の読み取り専用数値。numeric を text にして返す。security invoker により組織 RLS を適用する。';
