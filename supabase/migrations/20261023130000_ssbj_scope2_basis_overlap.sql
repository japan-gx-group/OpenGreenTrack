-- SSBJ 開示レポート（R2-23）: Scope 2 の外部算定値も、OGT の同じ基準の値と二重に計上しない（docs/ssbj-spec.md §7.2・§13「外部で算定した排出量」）。
--
-- 20261023110000_ssbj_external_emissions.sql では、OGT の Scope 2 は基準不明だったため、Scope 2 の外部算定値は
-- OGT の値と重ならないものとして扱っていた。20261023120000_ssbj_ogt_scope2_basis_totals.sql で、OGT の採用値の
-- Scope 2 に基準別の合計（method.basisTotals）が入るようになったので、Scope 2 の外部算定値は次のときに OGT と重なる:
--   - 対象ガスに CO2 を含み、同じ基準（location = locationBased、market = marketBased）の OGT の合計が算定済み（answered）。
--   - 基準別の合計を持たない採用値（基準別の値を取り込む前に採用したもの）や、その基準が未算定のときは重ならない。
--     OGT から得られない基準の値は、これまでどおり外部算定値で入れられる。
-- 基準の区別のない OGT の Scope 2 の値（温対法の係数区分による合計）は、基準別の値とは別の値として示すので、重なりには数えない。
-- Scope 1・Scope 3 の判定と、外部算定値どうしの判定（P2072）は変えない。判定の関数と 2 つのトリガー関数を置き換える
-- （トリガーそのものは 20261023110000 のまま）。

create or replace function ssbj_external_emission_overlap(
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
    when p_scope = 2 and 'CO2' = any (p_gases) and exists (
      select 1
      from public.ssbj_ogt_adoptions a
      cross join lateral jsonb_array_elements(a."adoptedValues") as v(value)
      where a."reportId" = p_report_id
        and (v.value ->> 'scope')::smallint = 2
        and v.value -> 'method' -> 'basisTotals'
          -> (case p_basis when 'location' then 'locationBased' when 'market' then 'marketBased' end)
          ->> 'state' = 'answered'
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
  '外部算定値が OGT の採用値（ogt。Scope 2 は同じ基準の合計）・ほかの外部算定値（external）と重なるか。重ならなければ null。';

revoke execute on function ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[]) from public, anon, authenticated;
grant execute on function ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[]) to service_role;

-- 外部算定値を書いたとき。メッセージに基準を足した（Scope 2 も止まるようになったため）。それ以外は 20261023110000 と同じ。
create or replace function ssbj_check_external_emission_overlap()
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
    raise exception 'この Scope・カテゴリ・基準の CO2 は、OGT の採用値に含まれています。二重に計上しないよう、対象ガスから CO2 を外すか、OGT の採用を見直してください'
      using errcode = 'P2071';
  elsif v_overlap = 'external' then
    raise exception '同じ Scope・カテゴリ・基準で、同じガスの外部算定値がすでにあります。二重に計上しないよう、どちらかを直してください'
      using errcode = 'P2072';
  end if;
  return null;
end;
$$;

-- OGT の値を採用したとき。メッセージに基準を足した。それ以外は 20261023110000 と同じ。
create or replace function ssbj_check_ogt_adoption_overlap()
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
    raise exception 'OGT の値を採用すると、CO2 を含む外部算定値（同じ Scope・カテゴリ・基準）と二重に計上されます。外部算定値を見直してから採用してください'
      using errcode = 'P2071';
  end if;
  return null;
end;
$$;
