-- OpenGreenTrack v1.0 初期スキーマ (3/4): RPC 関数
-- アプリが supabase.rpc() で呼ぶ 14 関数と EXECUTE 権限。複数テーブル更新の単一トランザクション化と画面向け集計を DB 側で行う。
-- §1 算定コミット  §2 Scope3・IDEA 取込  §3 重い API のレート制限  §4 ダッシュボード読取  §5 レポート読取
-- 適用順: 20260831000000_schema.sql・20260831000001_rls.sql の後。
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。関数本体 $$…$$ 内の DML は対象外）

-- EXECUTE: public の関数は既定で PUBLIC に公開されるため関数ごとに revoke → grant する（drop/create で作り直すと PUBLIC 付与に戻る）。
-- 書き込み系（§1〜§3）は service_role 限定。authenticated が /rpc/ を任意引数で叩けると他組織の emission_results 捏造・dashboard_aggregates 上書きが可能（認証・組織チェックは Route Handler）。
-- 読み取り系（§4〜§5）は authenticated + service_role。security invoker + stable で各テーブルの RLS がそのまま効く（anon 不可）。

-- §1 算定コミット

-- ダッシュボード集計の単一情報源（docs/IDEA連携Scope3算定仕様.md §5.1）。加算ではなく絶対値で再計算し、リトライやソース削除でドリフトさせない。
-- scope3Total の採用式は §4 dashboard_scope3_category_emissions と常に揃えること。
create function refresh_dashboard_aggregates(
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
    coalesce(sum(er.emissions) filter (where er.scope = 'scope2'), 0)
  into v_scope1, v_scope2
  from emission_results er
  join activity_records ar on ar.id = er."activityRecordId"
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
    ("organizationId", "fiscalYearId", "scope1Total", "scope2Total", "scope3Total")
  values (p_organization_id, p_fiscal_year_id, v_scope1, v_scope2, v_scope3)
  on conflict ("organizationId", "fiscalYearId")
  do update set
    "scope1Total" = excluded."scope1Total",
    "scope2Total" = excluded."scope2Total",
    "scope3Total" = excluded."scope3Total",
    "updatedAt" = now();
end;
$$;

revoke execute on function refresh_dashboard_aggregates(uuid, uuid) from public, anon, authenticated;
grant execute on function refresh_dashboard_aggregates(uuid, uuid) to service_role;

-- 算定結果の原子的確定。IDEA 由来要素は emissionFactorId = null + ideaFactorId + 適用時スナップショット appliedFactor*（§4.3-4・5）。
-- service_role で RLS を越えるため、activityRecordId が全件 p_organization_id の行であることを INSERT 前に検証する（他組織・不存在が 1 件でもあれば P2027 で全体中止）。
create function run_calculation_commit(
  p_batch_id uuid,
  p_organization_id uuid,
  p_fiscal_year_id uuid,
  p_results jsonb
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

comment on function run_calculation_commit(uuid, uuid, uuid, jsonb) is
  '算定結果の原子的確定（結果保存・isCalculated 更新・dashboard_aggregates 再計算・バッチ完了を 1 トランザクションで行う）。'
  'activityRecordId ごとに旧 emission_results 行があれば新しい算定値で上書きする（安全網）。'
  '通常は活動量の編集時にトリガー clear_emission_results_on_recalculation が同一トランザクションで旧行を消しているため、上書きが起きるのは例外的な状況に限る。'
  'バッチが自組織の pending でなければ（滞留として回収済み・完了済み）P2028 で全体中止する。'
  'service_role 限定。他組織・不存在の活動量が含まれれば P2027 で全体中止する。'
  '会計年度が p_organization_id に属さない場合も中止する。';

revoke execute on function run_calculation_commit(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function run_calculation_commit(uuid, uuid, uuid, jsonb) to service_role;

-- §2 Scope3・IDEA 取込
-- 仕様: docs/IDEA連携Scope3算定仕様.md §3.6・§4.1。SQLSTATE P2031（不存在・組織不一致・状態不正）/ P2032（参照中で削除不可）は ideaImportServer.ts の IDEA_IMPORT_SQLSTATE と揃える。

-- 取込完了処理（§3.6-1〜2・§4.1-3）。
-- 一括付け替えは、同一重複キー群（組織 × 拠点 × 対象月 × カテゴリ）の未算定明細が旧版の同一 ideaCode を参照していると 2 件目でトリガー prevent_duplicate_activity_record の 23505 になる。
-- そのためキー群 × ideaCode ごとに id 最小の 1 件だけ付け替え、残りは孤児化して unmappedRecordCount に含める（新キー定義では二重計上候補なので黙って同一係数へ寄せない）。
create function complete_idea_import(
  p_import_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status "IdeaImportStatus";
  v_row_count integer;
  v_unmapped integer := 0;
begin
  -- 組織単位で完了処理・削除を直列化（同時完了時の idea_imports_one_active_per_org 衝突・デッドロック防止）
  perform pg_advisory_xact_lock(hashtext('idea_import:' || p_organization_id::text));

  select status into v_status
  from idea_imports
  where id = p_import_id
    and "organizationId" = p_organization_id
  for update;
  if not found then
    raise exception '対象のインポートが見つかりません: %', p_import_id using errcode = 'P2031';
  end if;
  if v_status <> 'processing' then
    raise exception '取込中（processing）のインポートではありません: %', v_status using errcode = 'P2031';
  end if;

  select count(*) into v_row_count from idea_factors where "importId" = p_import_id;

  -- 未算定明細の再マッピング（§3.6-2）。not exists はキー群 × ideaCode で id 最小の 1 件だけ付け替えるデデュープ。算定済み明細は旧版参照のまま（§3.6-3）
  update activity_records ar
  set "ideaFactorId" = nf.id
  from idea_factors old_f
  join idea_factors nf
    on nf."importId" = p_import_id
   and nf."ideaCode" = old_f."ideaCode"
  where ar."ideaFactorId" = old_f.id
    and old_f."importId" <> p_import_id
    and ar."isCalculated" = false
    and ar."organizationId" = p_organization_id
    and not exists (
      select 1
      from activity_records ar2
      join idea_factors old_f2 on old_f2.id = ar2."ideaFactorId"
      where ar2.id < ar.id
        and ar2."organizationId" = ar."organizationId"
        and ar2."locationId" = ar."locationId"
        and ar2."energyType" = ar."energyType"
        and ar2."periodStart" = ar."periodStart"
        and ar2."scope3CategoryId" is not distinct from ar."scope3CategoryId"
        and ar2."isCalculated" = false
        and old_f2."importId" <> p_import_id
        and old_f2."ideaCode" = old_f."ideaCode"
    );

  -- 付け替えできなかった未算定明細を孤児化して件数を警告に記録。非null → null はトリガー検査対象外なので 23505 にならない
  with orphaned as (
    update activity_records ar
    set "ideaFactorId" = null
    from idea_factors old_f
    where ar."ideaFactorId" = old_f.id
      and old_f."importId" <> p_import_id
      and ar."isCalculated" = false
      and ar."organizationId" = p_organization_id
    returning ar.id
  )
  select count(*) into v_unmapped from orphaned;

  -- 順序厳守: 旧 active を false 化してから新を true 化する（逆順は idea_imports_one_active_per_org に衝突し 2 回目以降の取込が必ず失敗する。§4.1-3）
  update idea_imports
  set "isActive" = false
  where "organizationId" = p_organization_id
    and "isActive" = true
    and id <> p_import_id;

  update idea_imports
  set status = 'completed',
      "rowCount" = v_row_count,
      "unmappedRecordCount" = v_unmapped,
      "isActive" = true,
      "errorMessage" = null
  where id = p_import_id;

  return jsonb_build_object(
    'rowCount', v_row_count,
    'unmappedRecordCount', v_unmapped
  );
end;
$$;

revoke execute on function complete_idea_import(uuid, uuid) from public, anon, authenticated;
grant execute on function complete_idea_import(uuid, uuid) to service_role;

-- 取込の削除（§3.6-4）。組織スコープは p_organization_id で強制する（ロール判定はしない）。
create function delete_idea_import(
  p_import_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_referenced boolean;
begin
  perform pg_advisory_xact_lock(hashtext('idea_import:' || p_organization_id::text));

  perform 1
  from idea_imports
  where id = p_import_id
    and "organizationId" = p_organization_id
  for update;
  if not found then
    raise exception '対象のインポートが見つかりません: %', p_import_id using errcode = 'P2031';
  end if;

  -- emission_results から参照中は削除不可（§3.6-4）。FK は on delete set null で DB 制約では止まらないため、ここが唯一のガード
  select exists (
    select 1
    from emission_results er
    join idea_factors f on f.id = er."ideaFactorId"
    where f."importId" = p_import_id
  ) into v_referenced;
  if v_referenced then
    raise exception '算定結果から参照されているため削除できません' using errcode = 'P2032';
  end if;

  -- activity_records."ideaFactorId" は set null で外れ、以後は SCOPE3_FACTOR_MISSING 扱い（§4.3-1）
  delete from idea_imports where id = p_import_id;
end;
$$;

revoke execute on function delete_idea_import(uuid, uuid) from public, anon, authenticated;
grant execute on function delete_idea_import(uuid, uuid) to service_role;

-- §3 重い API のレート制限
-- 判定（DB カウント）→ ジョブ行作成を単一トランザクションで行う。組織単位に 2 窓: 稼働中（同時実行の抑制）と直近（窓内の作成数）。
-- 起点・上限は呼び出し側 src/lib/security/apiRateLimit.ts が渡し、count >= limit で超過。同時リクエストのすり抜け防止に
-- pg_advisory_xact_lock(20202 = 算定, hashtext(organizationId)) で直列化。SQLSTATE P2023・P2024・P2026 は apiRateLimit.ts の HEAVY_API_SQLSTATE と揃える。

-- fiscal_years の組織突き合わせ（Route Handler は organizationId しか検証しないため、年度の所有チェックは DB 側で行う。§1 の 2 関数も同じ突き合わせを持つ）。
-- 稼働中は "startedAt" >= p_pending_since で区切り、failed を書けず残った pending 滞留行が組織の算定を恒久ブロックしないようにする。
create function create_calculation_batch_with_rate_limit(
  p_organization_id uuid,
  p_fiscal_year_id uuid,
  p_pending_since timestamptz,
  p_recent_since timestamptz,
  p_pending_limit integer,
  p_recent_limit integer
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_batch_id uuid;
begin
  perform pg_advisory_xact_lock(20202, hashtext(p_organization_id::text));

  if not exists (
    select 1
    from fiscal_years
    where id = p_fiscal_year_id
      and "organizationId" = p_organization_id
  ) then
    raise exception using
      errcode = 'P2026',
      message = 'calculation_fiscal_year_invalid';
  end if;

  -- 稼働中とみなす窓（p_pending_since 以降）から外れた pending は、プロセスが落ちて誰も書き換えられなかった行。
  -- 年度を問わず組織内のものをまとめて failed に倒す（稼働中カウントも組織単位なので粒度を揃える）。
  update calculation_batches
  set status = 'failed',
      "errorMessage" = '算定処理が完了しないまま中断されたため、失敗として記録しました。再度算定を実行してください。',
      "completedAt" = now()
  where "organizationId" = p_organization_id
    and status = 'pending'
    and "startedAt" < p_pending_since;

  if (
    select count(*)
    from calculation_batches
    where "organizationId" = p_organization_id
      and status = 'pending'
      and "startedAt" >= p_pending_since
  ) >= p_pending_limit then
    raise exception using
      errcode = 'P2023',
      message = 'calculation_pending_rate_limited';
  end if;

  if (
    select count(*)
    from calculation_batches
    where "organizationId" = p_organization_id
      and "startedAt" >= p_recent_since
  ) >= p_recent_limit then
    raise exception using
      errcode = 'P2024',
      message = 'calculation_recent_rate_limited';
  end if;

  insert into calculation_batches ("organizationId", "fiscalYearId", status)
  values (p_organization_id, p_fiscal_year_id, 'pending')
  returning id into v_batch_id;

  return v_batch_id;
end;
$$;

comment on function create_calculation_batch_with_rate_limit(uuid, uuid, timestamptz, timestamptz, integer, integer) is
  '算定バッチの作成とレート制限判定を組織単位の advisory lock 内で原子的に行う。'
  'p_pending_since より前に始まった pending 行はプロセス消失による滞留とみなし、先に failed へ倒してから作成する。'
  'service_role 限定。P2023 = 同時実行上限、P2024 = 直近窓の上限、P2026 = 年度が組織に属さない。';

revoke execute on function create_calculation_batch_with_rate_limit(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer,
  integer
) from public, anon, authenticated;
grant execute on function create_calculation_batch_with_rate_limit(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer,
  integer
) to service_role;

-- §4 ダッシュボード読取

-- 月別 × Scope。予測・目標画面の年間実績フォールバックも同じ定義のため本関数を再利用する。activityRecordId が null の行は期間を特定できず対象外。
create function dashboard_monthly_emissions(
  p_start_date date,
  p_end_date date,
  p_location_id uuid default null
)
returns table ("monthStart" date, scope "Scope", emissions numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('month', ar."periodStart")::date as "monthStart",
    er.scope,
    sum(er.emissions) as emissions
  from emission_results er
  join activity_records ar on ar.id = er."activityRecordId"
  where ar."periodStart" >= p_start_date
    and ar."periodStart" <= p_end_date
    and (p_location_id is null or ar."locationId" = p_location_id)
    and (
      er.scope <> 'scope3'
      -- categoryId が null の Scope3 行は m."categoryId" = null が偽になり除外される
      or exists (
        select 1
        from fiscal_years fy
        join scope3_category_methods m
          on m."fiscalYearId" = fy.id
         and m."organizationId" = ar."organizationId"
         and m."categoryId" = er."categoryId"
        where fy."organizationId" = ar."organizationId"
          and ar."periodStart" between fy."startDate" and fy."endDate"
          and m.method = 'calculated'
      )
    )
  group by 1, 2
  order by 1, 2;
$$;

comment on function dashboard_monthly_emissions(date, date, uuid) is
  'ダッシュボード用: 期間内の活動量由来 emission_results を月初日×Scopeで集計して返す。'
  'Scope3 は periodStart が属する年度の scope3_category_methods が calculated のカテゴリだけを含める'
  '（KPI の採用値と同じ基準）。直接入力の Scope3 は年度単位で月内訳を持たないため、ここには意図的に含まれない。'
  'security invoker のため emission_results / activity_records / fiscal_years / scope3_category_methods の RLS'
  '（自組織のみ可視）がそのまま効くことを前提とする（関数内での組織スコープ検証は行わない）。';

revoke execute on function dashboard_monthly_emissions(date, date, uuid) from public, anon;
grant execute on function dashboard_monthly_emissions(date, date, uuid) to authenticated, service_role;

-- 拠点別 Scope1+2。Scope3 は組織・年度単位で拠点情報を持たないため locationId 付き行があっても除外し、拠点絞り込み KPI と集計系統を揃える。
-- 降順なので PostgREST の max_rows で末尾が切れても上位 N 拠点には影響しない。
create function dashboard_location_emissions(
  p_start_date date,
  p_end_date date
)
returns table ("locationId" uuid, name text, emissions numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    er."locationId",
    l.name::text as name,
    sum(er.emissions) as emissions
  from emission_results er
  join activity_records ar on ar.id = er."activityRecordId"
  left join locations l on l.id = er."locationId"
  where er."locationId" is not null
    and er.scope in ('scope1', 'scope2')
    and ar."periodStart" >= p_start_date
    and ar."periodStart" <= p_end_date
  group by er."locationId", l.name
  order by 3 desc, 1;
$$;

comment on function dashboard_location_emissions(date, date) is
  'ダッシュボード用: 期間内の拠点別 Scope1+2 排出量合計を降順で返す（上位拠点ランキング用）。'
  'security invoker のため emission_results / activity_records / locations の RLS'
  '（自組織のみ可視）がそのまま効くことを前提とする。';

revoke execute on function dashboard_location_emissions(date, date) from public, anon;
grant execute on function dashboard_location_emissions(date, date) to authenticated, service_role;

-- Scope3 カテゴリ別の採用値（方式適用後）。scope3_category_emissions を素で読むと calculated 切替済みの未採用値が出る / calculated のみのカテゴリが出ない / 構成比の分母が狂う。
create function dashboard_scope3_category_emissions(
  p_fiscal_year_id uuid
)
returns table ("categoryId" integer, emissions numeric)
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
  direct_input as (
    select e."categoryId" as category_id, sum(e.emissions) as total
    from scope3_category_emissions e
    where e."fiscalYearId" = p_fiscal_year_id
    group by e."categoryId"
  ),
  calculated_input as (
    -- 組織条件は RLS でも担保されるが refresh_dashboard_aggregates と揃えて明示する
    select er."categoryId" as category_id, sum(er.emissions) as total
    from emission_results er
    join activity_records ar on ar.id = er."activityRecordId"
    cross join fy
    where er.scope = 'scope3'
      and er."categoryId" between 1 and 15
      and ar."organizationId" = fy."organizationId"
      and ar."periodStart" between fy."startDate" and fy."endDate"
    group by er."categoryId"
  ),
  adopted as (
    select
      cat.category_id,
      case coalesce(m.method, 'direct'::"Scope3Method")
        when 'calculated' then coalesce(calculated_input.total, 0)
        else coalesce(direct_input.total, 0)
      end as emissions
    from generate_series(1, 15) as cat(category_id)
    left join scope3_category_methods m
      on m."fiscalYearId" = p_fiscal_year_id
     and m."categoryId" = cat.category_id
    left join direct_input on direct_input.category_id = cat.category_id
    left join calculated_input on calculated_input.category_id = cat.category_id
  )
  select cat.category_id::integer as "categoryId", cat.emissions
  from adopted cat
  where cat.emissions <> 0
  order by 1;
$$;

comment on function dashboard_scope3_category_emissions(uuid) is
  'ダッシュボード用: 会計年度のScope3カテゴリ別「採用値」（scope3_category_methods の方式適用後）を返す。'
  'refresh_dashboard_aggregates が scope3Total を導く式（§5.1）と同一のため、'
  '返り値の合計は dashboard_aggregates.scope3Total と一致する。'
  'security invoker のため関連テーブルの RLS（自組織のみ可視）がそのまま効く。';

revoke execute on function dashboard_scope3_category_emissions(uuid) from public, anon;
grant execute on function dashboard_scope3_category_emissions(uuid) to authenticated, service_role;

-- ダッシュボードの「排出量上位拠点」を、Scope 1 / Scope 2 の内訳・地域/種別・前年比まで
-- 出せる表に作り替えるための RPC（UI刷新）。
--
-- 既存の dashboard_location_emissions は Scope1+2 の合計しか返さないため、
-- 拠点 × Scope の粒度で返す関数を追加する。前年比は呼び出し側が
-- 前年度期間で同じ関数をもう一度呼んで算出する。
-- 既存の dashboard_location_emissions はこの移行でアプリから呼ばれなくなるが、関数の削除は
-- 影響範囲が読み切れないため行わない（不要になった時点で別マイグレーションで drop する）。
create function dashboard_location_emissions_by_scope(
  p_start_date date,
  p_end_date date
)
returns table (
  "locationId" uuid,
  name text,
  region text,
  type text,
  scope "Scope",
  emissions numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    er."locationId",
    l.name::text as name,
    l.region::text as region,
    l.type::text as type,
    er.scope,
    sum(er.emissions) as emissions
  from emission_results er
  join activity_records ar on ar.id = er."activityRecordId"
  left join locations l on l.id = er."locationId"
  where er."locationId" is not null
    -- Scope 3 は組織・年度単位の集計で拠点を持たないため、拠点別 KPI と系統を揃えて除外する。
    and er.scope in ('scope1', 'scope2')
    and ar."periodStart" >= p_start_date
    and ar."periodStart" <= p_end_date
  group by er."locationId", l.name, l.region, l.type, er.scope
  order by 6 desc, 1;
$$;

comment on function dashboard_location_emissions_by_scope(date, date) is
  'ダッシュボード用: 期間内の拠点 × Scope（1/2）別の排出量合計を返す（上位拠点テーブルの内訳・前年比用）。'
  'security invoker のため emission_results / activity_records / locations の RLS'
  '（自組織のみ可視）がそのまま効くことを前提とする。';

revoke execute on function dashboard_location_emissions_by_scope(date, date) from public, anon;
grant execute on function dashboard_location_emissions_by_scope(date, date) to authenticated, service_role;

-- §5 レポート読取
-- PostgREST の max_rows（既定 1000）で黙って切り詰められないよう、呼び出し側は range() でページングする。そのためキー順で安定ソートして返す。

-- 年度帰属は periodStart 基準（算定サービス calculationService・refresh_dashboard_aggregates・
-- report_location_energy_usage・report_activity_calculation_coverage と同基準）。
-- 算定バッチの "fiscalYearId" で絞らない理由: 期間が重なる年度が併存し得る（期首月を変更した後に
-- 年度を追加した場合など。既存年度の期間更新は無いが、重複期間の新規作成は排除されていない）。
-- 重複月のレコードは先に走った年度のバッチで算定済みになり、後の年度のバッチは未算定
-- （isCalculated = false）のレコードしか拾わないため、バッチ基準で絞ると年次サマリ
-- （dashboard_aggregates）とデータ充足状況には現れるのに拠点別表からだけ消える。
-- 画面・PDF とも選択中の 1 年度しか表示しないため、全年度を返して絞る作りにしない。
create function report_location_scope_emissions(p_fiscal_year_id uuid)
returns table (
  "fiscalYearId" uuid,
  "locationId" uuid,
  scope "Scope",
  emissions numeric,
  "recordCount" bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    fy.id as "fiscalYearId",
    er."locationId",
    er.scope,
    sum(er.emissions) as emissions,
    count(*) as "recordCount"
  from fiscal_years fy
  join activity_records ar
    on ar."periodStart" >= fy."startDate"
   and ar."periodStart" <= fy."endDate"
  -- 1 活動量 = 1 算定結果（emission_results_activity_record_unique）のため、この join で二重計上は起きない。
  join emission_results er on er."activityRecordId" = ar.id
  where fy.id = p_fiscal_year_id
    and er."locationId" is not null
  group by fy.id, er."locationId", er.scope
  order by er."locationId", er.scope;
$$;

comment on function report_location_scope_emissions(uuid) is
  'レポート用: 指定年度の期間に属する（periodStart 基準）活動量の emission_results を 拠点 × Scope で集計して返す。'
  '年度帰属は refresh_dashboard_aggregates / report_activity_calculation_coverage と同基準で、算定バッチの fiscalYearId では絞らない。'
  'security invoker のため fiscal_years / activity_records / emission_results の RLS（自組織のみ可視）が'
  'そのまま効くことを前提とする（関数内での組織スコープ検証は行わない。他組織の年度IDを渡しても fiscal_years が 0 行のため何も返らない）。';

revoke execute on function report_location_scope_emissions(uuid) from public, anon;
grant execute on function report_location_scope_emissions(uuid) to authenticated, service_role;

-- unit は varchar で同一種別に単位が混在しうるため単位ごとに別行で返す（クライアント側で単位をまたいで合算しない）。
create function report_location_energy_usage(
  p_start_date date,
  p_end_date date
)
returns table (
  "locationId" uuid,
  "energyType" text,
  unit text,
  amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ar."locationId",
    ar."energyType"::text as "energyType",
    ar.unit::text as unit,
    sum(ar.amount) as amount
  from activity_records ar
  where ar."periodStart" >= p_start_date
    and ar."periodStart" <= p_end_date
  group by ar."locationId", ar."energyType"::text, ar.unit::text
  order by ar."locationId", ar."energyType"::text, ar.unit::text;
$$;

comment on function report_location_energy_usage(date, date) is
  'レポート用: 期間内の活動量を 拠点 × エネルギー種別 × 単位 で合計して返す。'
  'security invoker のため activity_records の RLS（自組織のみ可視）がそのまま効くことを前提とする。';

revoke execute on function report_location_energy_usage(date, date) from public, anon;
grant execute on function report_location_energy_usage(date, date) to authenticated, service_role;

-- 年度ごとの最新算定バッチ。無条件 select して JS で先頭を拾うと max_rows で古い年度が欠落する。startedAt 同着は id で決定的に順序づける。
create function report_latest_calculation_batches()
returns table (
  id uuid,
  "fiscalYearId" uuid,
  status "BatchStatus",
  "processedCount" integer,
  "completedAt" timestamptz,
  "startedAt" timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (cb."fiscalYearId")
    cb.id,
    cb."fiscalYearId",
    cb.status,
    cb."processedCount",
    cb."completedAt",
    cb."startedAt"
  from calculation_batches cb
  order by cb."fiscalYearId", cb."startedAt" desc, cb.id desc;
$$;

comment on function report_latest_calculation_batches() is
  'レポート用: 会計年度ごとの最新の算定バッチを1行ずつ返す。'
  'security invoker のため calculation_batches の RLS（自組織のみ可視）がそのまま効くことを前提とする。';

revoke execute on function report_latest_calculation_batches() from public, anon;
grant execute on function report_latest_calculation_batches() to authenticated, service_role;

-- レポート用: 対象期間の活動量データの算定充足状況（算定済み / 未算定の件数）を返す RPC。
--
-- 背景: 係数が解決できなかったレコードは isCalculated = false のまま残り、emission_results にも
-- 集計にも現れない。算定バッチは未算定が残っていても completed になり、未解決一覧は実行直後の
-- 画面表示にしか残らないため、レポートだけを見ると「集計できた分の合計」を全体の排出量と
-- 誤認しうる。レポート本文に件数・充足率を載せるための集計をここで提供する。
--
-- 年度帰属は periodStart 基準（算定エンジン calculationService・report_location_energy_usage と同基準）。
-- 拠点 × エネルギー種別の粒度で返し、対象拠点・対象種別の絞り込みは呼び出し側で行う
-- （年次サマリは対象拠点で、Scope 3 詳細は energyType = 'scope3_activity' で絞る）。
create function report_activity_calculation_coverage(
  p_start_date date,
  p_end_date date
)
returns table (
  "locationId" uuid,
  "energyType" text,
  "calculatedCount" bigint,
  "uncalculatedCount" bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ar."locationId",
    ar."energyType"::text as "energyType",
    count(*) filter (where ar."isCalculated") as "calculatedCount",
    count(*) filter (where not ar."isCalculated") as "uncalculatedCount"
  from activity_records ar
  where ar."periodStart" >= p_start_date
    and ar."periodStart" <= p_end_date
  group by ar."locationId", ar."energyType"::text
  order by ar."locationId", ar."energyType"::text;
$$;

comment on function report_activity_calculation_coverage(date, date) is
  'レポート用: 期間内の活動量レコードを 拠点 × エネルギー種別 で数え、算定済み/未算定の件数を返す。'
  'security invoker のため activity_records の RLS（自組織のみ可視）がそのまま効くことを前提とする。';

revoke execute on function report_activity_calculation_coverage(date, date) from public, anon;
grant execute on function report_activity_calculation_coverage(date, date) to authenticated, service_role;

-- 背景: 算定バッチは方式（scope3_category_methods.method）に関係なく未算定レコードを全件算定するため、
-- 方式が direct のカテゴリに属する積上げ明細も isCalculated = true になる。一方でカテゴリ別の採用値
-- （refresh_dashboard_aggregates / dashboard_scope3_category_emissions の §5.1 の式）は direct のカテゴリで
-- 直接入力値だけを採用するため、これらの明細は 1 件もレポートの排出量に効かない。
-- 拠点 × エネルギー種別で数える report_activity_calculation_coverage ではこの区別ができず、
-- 「算定済み・充足率100%」と出た明細が実際には未採用、という誤読を招く。
-- そこでレポート側が「採用され得る明細」だけを数えられるよう、カテゴリと採用方式つきの件数を返す。
--
-- 年度帰属は periodStart 基準（算定エンジン calculationService・report_activity_calculation_coverage と同基準）。
-- 方式行が無いカテゴリの既定は 'direct'（scope3_category_methods と同じ）。カテゴリ未設定
-- （scope3CategoryId is null）の明細はどのカテゴリの採用値にもならないため categoryId = null の行として返し、
-- 呼び出し側で採用対象外として扱う。
create function report_scope3_activity_calculation_coverage(
  p_fiscal_year_id uuid
)
returns table (
  "categoryId" integer,
  method "Scope3Method",
  "calculatedCount" bigint,
  "uncalculatedCount" bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with fy as (
    select f.id, f."startDate", f."endDate"
    from fiscal_years f
    where f.id = p_fiscal_year_id
  )
  select
    ar."scope3CategoryId" as "categoryId",
    coalesce(m.method, 'direct'::"Scope3Method") as method,
    count(*) filter (where ar."isCalculated") as "calculatedCount",
    count(*) filter (where not ar."isCalculated") as "uncalculatedCount"
  from activity_records ar
  cross join fy
  left join scope3_category_methods m
    on m."fiscalYearId" = fy.id
   and m."categoryId" = ar."scope3CategoryId"
  where ar."energyType" = 'scope3_activity'
    and ar."periodStart" >= fy."startDate"
    and ar."periodStart" <= fy."endDate"
  group by ar."scope3CategoryId", coalesce(m.method, 'direct'::"Scope3Method")
  order by 1;
$$;

comment on function report_scope3_activity_calculation_coverage(uuid) is
  'レポート用: 会計年度の Scope 3 積上げ明細（energyType = scope3_activity）を カテゴリ × 採用方式 で数え、'
  '算定済み/未算定の件数を返す。方式が direct のカテゴリの明細は算定済みでも集計に採用されないため、'
  '充足状況の分母・分子から外せるように方式を添えて返す。'
  'security invoker のため activity_records / fiscal_years / scope3_category_methods の RLS'
  '（自組織のみ可視）がそのまま効くことを前提とする。';

revoke execute on function report_scope3_activity_calculation_coverage(uuid) from public, anon;
grant execute on function report_scope3_activity_calculation_coverage(uuid) to authenticated, service_role;
