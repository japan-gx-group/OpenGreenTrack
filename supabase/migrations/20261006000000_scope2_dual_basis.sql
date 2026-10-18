-- Scope 2 の基準別算定（GHG プロトコルのロケーション基準／マーケット基準）
--
-- 既存の Scope 2（dashboard_aggregates.scope2Total）は温対法の係数区分（基礎/調整後）に基づく
-- 単一値であり、GHG プロトコルの 2 基準とは定義が一致しない。ここでは単一値はそのまま残し、
-- 基準別の算定結果を明細（scope2_basis_results）と年度集計（dashboard_aggregates の追加列）に
-- 独立して保存する。温対法区分から基準を推定することはしない。
-- 算定規則・根拠不足時の扱いは docs/calculation-logic.md「Scope 2 の基準別算定」を参照。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。関数本体 $$…$$ 内の DML は対象外）

-- §1 型

-- GHG プロトコル Scope 2 ガイダンスの 2 基準。
create type "Scope2Basis" as enum ('location_based', 'market_based');
comment on type "Scope2Basis" is
  'Scope 2 の算定基準。location_based = ロケーション基準（系統平均係数）/ market_based = マーケット基準（契約に基づく係数）。';

-- 基準別の値の算定根拠の種別。値と一緒に保存し、「何を根拠にした値か」を常に提示できるようにする。
create type "Scope2BasisEvidence" as enum ('grid_average', 'contract_menu', 'grid_fallback');
comment on type "Scope2BasisEvidence" is
  'Scope 2 基準別算定の根拠種別。grid_average = 全国代替値（系統平均の代替。ロケーション基準）/ '
  'contract_menu = 明示選択された供給事業者のメニュー別係数（契約根拠。マーケット基準）/ '
  'grid_fallback = 契約情報が無く全国代替値で補完（マーケット基準。日本には残差ミックスの公表が無いため）。';

-- §2 明細テーブル

-- 1 活動量レコード × 1 基準 = 1 行。emission_results（単一値の明細）と同じライフサイクルで生き死にする:
--   - activityRecordId の FK は emission_results("activityRecordId")（unique）を参照する。活動量の編集で
--     clear_emission_results_on_recalculation トリガーが emission_results を消すと、基準別行も cascade で消える。
--     活動量・拠点の削除も emission_results 経由の cascade で届く（新しいトリガーは増やさない）。
--   - 書き込みは run_calculation_commit（service_role 限定 RPC）のみ。authenticated は SELECT のみ
--     （emission_results と同じ理由: GHG 報告値の完全性。20260831000001_rls.sql §の冒頭コメント参照）。
create table scope2_basis_results (
  id uuid primary key default gen_random_uuid(),
  -- RLS の組織判定用に非正規化（emission_results と同じパターン）。
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "activityRecordId" uuid not null references emission_results("activityRecordId") on delete cascade,
  basis "Scope2Basis" not null,
  evidence "Scope2BasisEvidence" not null,
  "emissionFactorId" uuid references emission_factors(id) on delete set null,
  -- 明細の保存精度は emission_results.emissions と同じ 1g 粒度（表示丸めは第3位）。
  emissions numeric(15, 6) not null,
  -- 監査用スナップショット: 参照先の係数が版更新・削除されても適用時の内容を保持する（emission_results と同じ理由）。
  "appliedFactorValue" numeric,
  "appliedFactorUnit" varchar(50),
  "appliedFactorName" varchar(500),
  "calculatedAt" timestamptz not null default now(),
  constraint scope2_basis_results_record_basis_unique unique ("activityRecordId", basis),
  -- 根拠種別と基準の組み合わせを DB でも強制する（契約根拠がロケーション基準に付く等の混同をアプリのバグから守る）。
  constraint scope2_basis_results_evidence_matches_basis check (
    (basis = 'location_based' and evidence = 'grid_average')
    or (basis = 'market_based' and evidence in ('contract_menu', 'grid_fallback'))
  )
);

comment on table scope2_basis_results is
  'Scope 2 のロケーション基準／マーケット基準それぞれの算定明細。既存の emission_results（温対法区分に基づく単一値）とは独立に保存する。';
comment on column scope2_basis_results.evidence is
  '値の算定根拠の種別。マーケット基準で grid_fallback の行は契約根拠が無い補完値であり、集計側で契約根拠つきの値と区別して提示する。';

create index "scope2_basis_results_organizationId_idx" on scope2_basis_results ("organizationId");

-- §3 RLS・権限

alter table scope2_basis_results enable row level security;

create policy "scope2_basis_results_select_own_organization"
on scope2_basis_results
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- authenticated は読み取りのみ（書き込みは service_role 限定の run_calculation_commit 経由。
-- 20260831000001_rls.sql §4.1 で新規テーブルの既定権限は無しのため、SELECT を明示 grant する）。
grant select on scope2_basis_results to authenticated;
grant select, insert, update, delete on scope2_basis_results to service_role;

-- §4 年度集計列

-- null = 基準別は未算定（算定の実行前、または期間内の Scope 2 明細に基準別行が揃っていない）。
-- 単一値 scope2Total の 0 既定とは意味が違うため、既定値は与えない。
alter table dashboard_aggregates
  add column "scope2LocationBasedTotal" numeric(15, 3),
  add column "scope2MarketBasedTotal" numeric(15, 3),
  add column "scope2MarketContractTotal" numeric(15, 3);

comment on column dashboard_aggregates."scope2LocationBasedTotal" is
  'Scope 2 ロケーション基準の年度合計。null = 未算定（期間内の全 Scope 2 明細に基準別行が揃ったときだけ値が入る。部分合計は過小表示になるため出さない）。';
comment on column dashboard_aggregates."scope2MarketBasedTotal" is
  'Scope 2 マーケット基準の年度合計。null = 未算定。契約根拠（contract_menu）の明細と代替値補完（grid_fallback）の明細の合算。';
comment on column dashboard_aggregates."scope2MarketContractTotal" is
  'scope2MarketBasedTotal のうち契約根拠（明示選択されたメニュー別係数）に基づく部分。補完分 = scope2MarketBasedTotal - scope2MarketContractTotal。';

-- §5 集計 RPC の差し替え（基準別合計の再計算を追加）

-- 既存の定義（20260831000002_rpc.sql）に §追加分: scope2_basis_results の基準別合計を同じ
-- 「加算ではなく絶対値で再計算」方式で dashboard_aggregates の追加列へ書く。
-- 期間内の Scope 2 明細（emission_results）の件数と基準別行の件数が一致するときだけ合計を出し、
-- 揃っていなければ null（未算定）とする。欠けがあるのに合計すると過小な値が基準別値として
-- 表示されるため（根拠不足の値を基準別の値として見せない）。
create or replace function refresh_dashboard_aggregates(
  p_organization_id uuid,
  p_fiscal_year_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_fy_start date;
  v_fy_end date;
  -- 明細 emission_results は numeric(15,6) だが合計は (15,3) に丸める（§3.4）
  v_scope1 numeric(15, 3);
  v_scope2 numeric(15, 3);
  v_scope3 numeric(15, 3);
  v_scope2_count integer;
  v_loc_total numeric(15, 3);
  v_loc_count integer;
  v_mkt_total numeric(15, 3);
  v_mkt_count integer;
  v_mkt_contract numeric(15, 3);
begin
  -- service_role で RLS を越えるため、年度が p_organization_id のものであることをここで突き合わせる
  -- （Route Handler にバグがあっても、他組織年度の日付窓で自組織の集計行を作らせない）。
  select "startDate", "endDate" into v_fy_start, v_fy_end
  from fiscal_years
  where id = p_fiscal_year_id
    and "organizationId" = p_organization_id;
  if not found then
    raise exception '会計年度が見つからないか、組織に属していません: %', p_fiscal_year_id;
  end if;

  -- 年度帰属は periodStart 基準（算定サービスの取得条件と同じ）
  select
    coalesce(sum(er.emissions) filter (where er.scope = 'scope1'), 0),
    coalesce(sum(er.emissions) filter (where er.scope = 'scope2'), 0),
    count(*) filter (where er.scope = 'scope2')
  into v_scope1, v_scope2, v_scope2_count
  from emission_results er
  join activity_records ar on ar.id = er."activityRecordId"
  where ar."organizationId" = p_organization_id
    and ar."periodStart" between v_fy_start and v_fy_end;

  -- Scope 2 基準別。明細と同じ periodStart 窓で合計する。
  select
    coalesce(sum(sbr.emissions) filter (where sbr.basis = 'location_based'), 0),
    count(*) filter (where sbr.basis = 'location_based'),
    coalesce(sum(sbr.emissions) filter (where sbr.basis = 'market_based'), 0),
    count(*) filter (where sbr.basis = 'market_based'),
    coalesce(sum(sbr.emissions) filter (where sbr.basis = 'market_based' and sbr.evidence = 'contract_menu'), 0)
  into v_loc_total, v_loc_count, v_mkt_total, v_mkt_count, v_mkt_contract
  from scope2_basis_results sbr
  join activity_records ar on ar.id = sbr."activityRecordId"
  where ar."organizationId" = p_organization_id
    and ar."periodStart" between v_fy_start and v_fy_end;

  -- Scope3 は方式ごとの採用値（§5.1）。calculated 切替後も直接入力値は削除せず残す（切替の可逆性）
  select coalesce(sum(
    case coalesce(m.method, 'direct'::"Scope3Method")
      when 'calculated' then coalesce(calc.total, 0)
      else coalesce(direct_input.total, 0)
    end
  ), 0)
  into v_scope3
  from generate_series(1, 15) as cat(category_id)
  left join scope3_category_methods m
    on m."organizationId" = p_organization_id
   and m."fiscalYearId" = p_fiscal_year_id
   and m."categoryId" = cat.category_id
  left join (
    select "categoryId", sum(emissions) as total
    from scope3_category_emissions
    where "organizationId" = p_organization_id
      and "fiscalYearId" = p_fiscal_year_id
    group by "categoryId"
  ) as direct_input on direct_input."categoryId" = cat.category_id
  left join (
    select er."categoryId", sum(er.emissions) as total
    from emission_results er
    join activity_records ar on ar.id = er."activityRecordId"
    where ar."organizationId" = p_organization_id
      and er.scope = 'scope3'
      and er."categoryId" between 1 and 15
      and ar."periodStart" between v_fy_start and v_fy_end
    group by er."categoryId"
  ) as calc on calc."categoryId" = cat.category_id;

  insert into dashboard_aggregates
    ("organizationId", "fiscalYearId", "scope1Total", "scope2Total", "scope3Total",
     "scope2LocationBasedTotal", "scope2MarketBasedTotal", "scope2MarketContractTotal")
  values (
    p_organization_id, p_fiscal_year_id, v_scope1, v_scope2, v_scope3,
    case when v_scope2_count = v_loc_count then v_loc_total end,
    case when v_scope2_count = v_mkt_count then v_mkt_total end,
    case when v_scope2_count = v_mkt_count then v_mkt_contract end
  )
  on conflict ("organizationId", "fiscalYearId")
  do update set
    "scope1Total" = excluded."scope1Total",
    "scope2Total" = excluded."scope2Total",
    "scope3Total" = excluded."scope3Total",
    "scope2LocationBasedTotal" = excluded."scope2LocationBasedTotal",
    "scope2MarketBasedTotal" = excluded."scope2MarketBasedTotal",
    "scope2MarketContractTotal" = excluded."scope2MarketContractTotal",
    "updatedAt" = now();
end;
$$;

-- create or replace は既存の EXECUTE 権限を保持するが、方針（service_role 限定）をこのファイル単体でも
-- 読めるように明示し直す。
revoke execute on function refresh_dashboard_aggregates(uuid, uuid) from public, anon, authenticated;
grant execute on function refresh_dashboard_aggregates(uuid, uuid) to service_role;

-- §6 算定コミット RPC の差し替え（基準別明細の保存を追加）

-- 引数を増やすため drop → create（create or replace は引数構成の変更ができない）。
-- drop/create で EXECUTE が PUBLIC 付与に戻るため、末尾で revoke → grant を必ずやり直す（rpc.sql 冒頭の注意）。
drop function run_calculation_commit(uuid, uuid, uuid, jsonb);

create function run_calculation_commit(
  p_batch_id uuid,
  p_organization_id uuid,
  p_fiscal_year_id uuid,
  p_results jsonb,
  p_scope2_basis_results jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_processed integer;
  v_delta numeric(15, 3);
  v_foreign_count integer;
begin
  -- 年度も activityRecordId と同じく p_organization_id への帰属を突き合わせる（service_role は RLS を越えるため）
  perform 1
    from fiscal_years
   where id = p_fiscal_year_id
     and "organizationId" = p_organization_id;
  if not found then
    raise exception '会計年度が見つからないか、組織に属していません: %', p_fiscal_year_id;
  end if;

  perform 1
    from calculation_batches
   where id = p_batch_id
     and "organizationId" = p_organization_id
     and status = 'pending'
     for update;
  if not found then
    raise exception '算定バッチが実行中ではありません（回収済みか完了済み）: %', p_batch_id
      using errcode = 'P2028';
  end if;

  -- service_role で RLS を越えるため、activityRecordId が全件 p_organization_id の行であることを INSERT 前に検証する
  -- （他組織・不存在が 1 件でもあれば P2027 で全体中止）。
  select count(*)
    into v_foreign_count
    from jsonb_array_elements(p_results) as r
    left join activity_records ar on ar.id = (r->>'activityRecordId')::uuid
   where ar.id is null
      or ar."organizationId" <> p_organization_id;

  if v_foreign_count > 0 then
    raise exception '他組織または存在しない活動量レコードが算定結果に含まれています: % 件', v_foreign_count
      using errcode = 'P2027';
  end if;

  -- 基準別明細も同じ検証を通す（基準別は算定済みレコードへの後追い付与があり、p_results の部分集合とは限らない）。
  select count(*)
    into v_foreign_count
    from jsonb_array_elements(p_scope2_basis_results) as r
    left join activity_records ar on ar.id = (r->>'activityRecordId')::uuid
   where ar.id is null
      or ar."organizationId" <> p_organization_id;

  if v_foreign_count > 0 then
    raise exception '他組織または存在しない活動量レコードが基準別算定結果に含まれています: % 件', v_foreign_count
      using errcode = 'P2027';
  end if;

  -- 旧行が残っていても失敗させず、新しい算定値で上書きする（1 活動量 = 1 算定結果）。
  -- IDEA 由来要素は emissionFactorId = null + ideaFactorId + 適用時スナップショット appliedFactor*（§4.3-4・5）。
  insert into emission_results
    ("organizationId", "activityRecordId", "emissionFactorId", "ideaFactorId", "batchId",
     "locationId", scope, "categoryId", emissions,
     "appliedFactorValue", "appliedFactorUnit", "appliedFactorName")
  select
    p_organization_id,
    (r->>'activityRecordId')::uuid,
    nullif(r->>'emissionFactorId', '')::uuid,
    nullif(r->>'ideaFactorId', '')::uuid,
    p_batch_id,
    (r->>'locationId')::uuid,
    (r->>'scope')::"Scope",
    nullif(r->>'categoryId', '')::integer,
    (r->>'emissions')::numeric,
    nullif(r->>'appliedFactorValue', '')::numeric,
    nullif(r->>'appliedFactorUnit', ''),
    nullif(r->>'appliedFactorName', '')
  from jsonb_array_elements(p_results) as r
  on conflict ("activityRecordId") do update set
    "organizationId" = excluded."organizationId",
    "emissionFactorId" = excluded."emissionFactorId",
    "ideaFactorId" = excluded."ideaFactorId",
    "batchId" = excluded."batchId",
    "locationId" = excluded."locationId",
    scope = excluded.scope,
    "categoryId" = excluded."categoryId",
    emissions = excluded.emissions,
    "appliedFactorValue" = excluded."appliedFactorValue",
    "appliedFactorUnit" = excluded."appliedFactorUnit",
    "appliedFactorName" = excluded."appliedFactorName",
    "calculatedAt" = now();

  -- 基準別明細は「対象レコードぶん削除 → 挿入」で入れ替える（upsert にしないのは、再算定で
  -- 片方の基準が解決不能になったとき旧行が残って過大計上になるため）。
  -- p_results 側の全レコードも対象に含め、基準別が 1 行も解決できなかったレコードの旧行を確実に消す。
  delete from scope2_basis_results
  where "activityRecordId" in (
    select (r->>'activityRecordId')::uuid from jsonb_array_elements(p_results) as r
    union
    select (r->>'activityRecordId')::uuid from jsonb_array_elements(p_scope2_basis_results) as r
  );

  -- emission_results 行が存在するレコードだけ挿入する（FK 先）。バッチ実行中に活動量が編集され
  -- トリガーが emission_results を消した場合、そのレコードの基準別行は黙って見送る（次回算定で付く）。
  insert into scope2_basis_results
    ("organizationId", "activityRecordId", basis, evidence, "emissionFactorId", emissions,
     "appliedFactorValue", "appliedFactorUnit", "appliedFactorName")
  select
    p_organization_id,
    (r->>'activityRecordId')::uuid,
    (r->>'basis')::"Scope2Basis",
    (r->>'evidence')::"Scope2BasisEvidence",
    nullif(r->>'emissionFactorId', '')::uuid,
    (r->>'emissions')::numeric,
    nullif(r->>'appliedFactorValue', '')::numeric,
    nullif(r->>'appliedFactorUnit', ''),
    nullif(r->>'appliedFactorName', '')
  from jsonb_array_elements(p_scope2_basis_results) as r
  where exists (
    select 1 from emission_results er
    where er."activityRecordId" = (r->>'activityRecordId')::uuid
  );

  update activity_records set "isCalculated" = true
  where "organizationId" = p_organization_id
    and id in (
      select (r->>'activityRecordId')::uuid from jsonb_array_elements(p_results) as r
    );

  perform refresh_dashboard_aggregates(p_organization_id, p_fiscal_year_id);

  v_processed := jsonb_array_length(p_results);
  select coalesce(sum((r->>'emissions')::numeric), 0) into v_delta
  from jsonb_array_elements(p_results) as r
  where r->>'scope' in ('scope1', 'scope2');

  update calculation_batches
  set status = 'completed',
      "processedCount" = v_processed,
      "totalEmissionsDelta" = v_delta,
      "completedAt" = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'processedCount', v_processed,
    'totalEmissionsDelta', v_delta
  );
end;
$$;

comment on function run_calculation_commit(uuid, uuid, uuid, jsonb, jsonb) is
  '算定結果の原子的確定（結果保存・Scope 2 基準別明細の入れ替え・isCalculated 更新・dashboard_aggregates 再計算・バッチ完了を 1 トランザクションで行う）。';

revoke execute on function run_calculation_commit(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function run_calculation_commit(uuid, uuid, uuid, jsonb, jsonb) to service_role;
