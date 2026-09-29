-- Scope 2 の係数区分別内訳は年度合計と同じ小数第3位で表示する。
-- 区分ごとの丸め差だけを最大の区分へ配分し、算定明細と年度集計そのものの差は補正しない。
create or replace function ssbj_ogt_numeric_values(p_fiscal_year_id uuid)
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
      coalesce(sum(er.emissions) filter (where ef."factorType" = 'basic'), 0) as basic,
      coalesce(sum(er.emissions) filter (where ef."factorType" = 'adjusted'), 0) as adjusted,
      coalesce(sum(er.emissions) filter (where ef."factorType" is null), 0) as unclassified
    from fy
    join activity_records ar
      on ar."organizationId" = fy."organizationId"
     and ar."periodStart" between fy."startDate" and fy."endDate"
    join emission_results er on er."activityRecordId" = ar.id and er.scope = 'scope2'
    left join emission_factors ef on ef.id = er."emissionFactorId"
  ),
  scope2_display as (
    select
      result_count,
      round(basic, 3) as basic,
      round(adjusted, 3) as adjusted,
      round(unclassified, 3) as unclassified,
      round(basic + adjusted + unclassified, 3)
        - round(basic, 3) - round(adjusted, 3) - round(unclassified, 3) as rounding_difference,
      case
        when basic >= adjusted and basic >= unclassified then 'basic'
        when adjusted >= unclassified then 'adjusted'
        else 'unclassified'
      end as adjustment_target
    from scope2_parts
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
        'basic', (basic + case when adjustment_target = 'basic' then rounding_difference else 0 end)::numeric(15, 3)::text,
        'adjusted', (adjusted + case when adjustment_target = 'adjusted' then rounding_difference else 0 end)::numeric(15, 3)::text,
        'unclassified', (unclassified + case when adjustment_target = 'unclassified' then rounding_difference else 0 end)::numeric(15, 3)::text
      ) end from scope2_display
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
