-- IDEA の版（取込）を算定年度ごとに割り当てる（idea_fiscal_year_imports）
--
-- これまでは組織で有効な版（idea_imports."isActive"）が 1 つだけで全年度に共通だった。新しい版を取り込むと、
-- 年度を問わず未算定の活動量が新しい版へ付け替わり、過年度を当時の版で算定し続けられなかった。
-- 1 つの会計年度に 1 つの版を割り当てられるようにし、割り当てた年度の製品検索・付け替えはその版で行う。
-- 割り当てていない年度は、これまでどおり有効な版を使う。年度の途中での版の切り替えは扱わない。
-- 算定・付け替えの規則は docs/idea-scope3-spec.md §3.6 を参照。
--
-- 規約: AGENTS.md R9（追記のみ）/ R12（DDL 専用。関数本体 $$…$$ 内の DML は対象外）

-- §1 テーブル

-- 1 会計年度 = 1 行（fiscalYearId が主キー）。割り当ての無い年度は行を持たない。
create table idea_fiscal_year_imports (
  "fiscalYearId" uuid primary key references fiscal_years(id) on delete cascade,
  -- RLS の組織判定用（年度・版と同じ組織であることは assign_idea_import_to_fiscal_year が検証する）。
  "organizationId" uuid not null references organizations(id) on delete cascade,
  -- restrict: 割り当て中の版は消せない（先に割り当てを外す）。delete_idea_import がわかりやすいエラーで先に止める。
  "importId" uuid not null references idea_imports(id) on delete restrict,
  "assignedByUserId" uuid,
  "assignedAt" timestamptz not null default now()
);

comment on table idea_fiscal_year_imports is
  '会計年度ごとに使う IDEA の版。割り当ての無い年度は組織で有効な版（idea_imports."isActive"）を使う。';

create index "idea_fiscal_year_imports_organizationId_idx" on idea_fiscal_year_imports ("organizationId");
create index "idea_fiscal_year_imports_importId_idx" on idea_fiscal_year_imports ("importId");

-- §2 RLS・権限

alter table idea_fiscal_year_imports enable row level security;

-- IDEA のライセンスは法人単位のため、idea_imports と同じく自組織のみ（グループ会社にも共有しない）。
create policy "idea_fiscal_year_imports_select_own_organization"
on idea_fiscal_year_imports
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

-- 書き込みは service_role 限定の assign_idea_import_to_fiscal_year だけ（割り当てと同時に未算定の付け替えを行うため）。
grant select on idea_fiscal_year_imports to authenticated;
grant select, insert, update, delete on idea_fiscal_year_imports to service_role;

-- §3 年度への版の割り当て

-- p_import_id = null は割り当てを外す（その年度は有効な版に戻る）。
-- 割り当て（または外した後の有効な版）に合わせて、その年度の未算定の活動量を ideaCode 一致で付け替える。
-- 一致する製品が無いものは ideaFactorId = null にして件数を返す（製品の再選択が必要。complete_idea_import と同じ扱い）。
-- 算定済みの活動量は付け替えない（適用時点の版と値を監査用に保持する。§3.6-3）。
create function assign_idea_import_to_fiscal_year(
  p_organization_id uuid,
  p_fiscal_year_id uuid,
  p_import_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fy_start date;
  v_fy_end date;
  v_status "IdeaImportStatus";
  v_target uuid;
  v_remapped integer := 0;
  v_unmapped integer := 0;
begin
  -- 取込完了・削除と同じロックで直列化する（付け替えの最中に版が入れ替わらないようにする）
  perform pg_advisory_xact_lock(hashtext('idea_import:' || p_organization_id::text));

  -- service_role で RLS を越えるため、年度・版が p_organization_id のものであることをここで突き合わせる
  select "startDate", "endDate" into v_fy_start, v_fy_end
  from fiscal_years
  where id = p_fiscal_year_id
    and "organizationId" = p_organization_id;
  if not found then
    raise exception '会計年度が見つからないか、組織に属していません: %', p_fiscal_year_id using errcode = 'P2034';
  end if;

  if p_import_id is not null then
    select status into v_status
    from idea_imports
    where id = p_import_id
      and "organizationId" = p_organization_id;
    if not found then
      raise exception '対象のインポートが見つかりません: %', p_import_id using errcode = 'P2031';
    end if;
    if v_status <> 'completed' then
      raise exception '取込が完了していない版は割り当てられません: %', v_status using errcode = 'P2031';
    end if;

    insert into idea_fiscal_year_imports ("fiscalYearId", "organizationId", "importId", "assignedByUserId")
    values (p_fiscal_year_id, p_organization_id, p_import_id, p_user_id)
    on conflict ("fiscalYearId") do update set
      "importId" = excluded."importId",
      "assignedByUserId" = excluded."assignedByUserId",
      "assignedAt" = now();
    v_target := p_import_id;
  else
    delete from idea_fiscal_year_imports
    where "fiscalYearId" = p_fiscal_year_id
      and "organizationId" = p_organization_id;
    select id into v_target
    from idea_imports
    where "organizationId" = p_organization_id
      and "isActive" = true;
  end if;

  -- 有効な版も無い年度（割り当てを外し、取込も無い）は付け替え先が無いので、活動量には触れない
  if v_target is not null then
    -- not exists は同じキー（拠点・種別・期間・カテゴリ）× ideaCode で id 最小の 1 件だけ付け替えるデデュープ
    -- （付け替え後に重複キーにならないようにする。complete_idea_import と同じ）
    with remapped as (
      update activity_records ar
      set "ideaFactorId" = nf.id
      from idea_factors old_f
      join idea_factors nf
        on nf."importId" = v_target
       and nf."ideaCode" = old_f."ideaCode"
      where ar."ideaFactorId" = old_f.id
        and old_f."importId" <> v_target
        and ar."isCalculated" = false
        and ar."organizationId" = p_organization_id
        and ar."periodStart" between v_fy_start and v_fy_end
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
            and old_f2."importId" <> v_target
            and old_f2."ideaCode" = old_f."ideaCode"
        )
      returning ar.id
    )
    select count(*) into v_remapped from remapped;

    -- 付け替えできなかった未算定の活動量は製品の再選択が必要として外す
    with orphaned as (
      update activity_records ar
      set "ideaFactorId" = null
      from idea_factors old_f
      where ar."ideaFactorId" = old_f.id
        and old_f."importId" <> v_target
        and ar."isCalculated" = false
        and ar."organizationId" = p_organization_id
        and ar."periodStart" between v_fy_start and v_fy_end
      returning ar.id
    )
    select count(*) into v_unmapped from orphaned;
  end if;

  return jsonb_build_object(
    'importId', v_target,
    'remappedCount', v_remapped,
    'unmappedCount', v_unmapped
  );
end;
$$;

comment on function assign_idea_import_to_fiscal_year(uuid, uuid, uuid, uuid) is
  '会計年度に IDEA の版を割り当てる（null で外す）。あわせてその年度の未算定の活動量を割り当てた版（外したときは有効な版）へ付け替える。';

revoke execute on function assign_idea_import_to_fiscal_year(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function assign_idea_import_to_fiscal_year(uuid, uuid, uuid, uuid) to service_role;

-- §4 取込完了の差し替え（版を割り当てた年度の活動量は新しい版へ付け替えない）

-- 既存の定義（20260831000002_rpc.sql）に、付け替え・孤児化の対象から「版を割り当てた年度」の活動量を除く条件を足す。
-- 割り当てた年度の活動量はその版のまま使い続ける（付け替えると、年度ごとに版を固定した意味が無くなる）。
-- 孤児化（ideaFactorId = null）も同じく除く: 割り当てた版を参照している活動量を、新しい版に同じ製品が無いことを
-- 理由に外してしまわないため。
create or replace function complete_idea_import(
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
  -- 版を割り当てた年度（idea_fiscal_year_imports）の明細は対象外（その年度の版のまま）
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
      from idea_fiscal_year_imports m
      join fiscal_years fy on fy.id = m."fiscalYearId"
      where m."organizationId" = p_organization_id
        and ar."periodStart" between fy."startDate" and fy."endDate"
    )
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
  -- 版を割り当てた年度の明細は対象外（割り当てた版を参照し続ける）
  with orphaned as (
    update activity_records ar
    set "ideaFactorId" = null
    from idea_factors old_f
    where ar."ideaFactorId" = old_f.id
      and old_f."importId" <> p_import_id
      and ar."isCalculated" = false
      and ar."organizationId" = p_organization_id
      and not exists (
        select 1
        from idea_fiscal_year_imports m
        join fiscal_years fy on fy.id = m."fiscalYearId"
        where m."organizationId" = p_organization_id
          and ar."periodStart" between fy."startDate" and fy."endDate"
      )
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

-- create or replace は既存の EXECUTE 権限を保持するが、方針（service_role 限定）をこのファイル単体でも読めるように明示し直す。
revoke execute on function complete_idea_import(uuid, uuid) from public, anon, authenticated;
grant execute on function complete_idea_import(uuid, uuid) to service_role;

-- §5 取込の削除の差し替え（年度に割り当て中の版は削除できない）

create or replace function delete_idea_import(
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

  -- 会計年度に割り当て中の版は削除不可（先に割り当てを外す）。FK の restrict より先にわかりやすいエラーで止める
  if exists (
    select 1 from idea_fiscal_year_imports where "importId" = p_import_id
  ) then
    raise exception '算定年度に割り当てられているため削除できません' using errcode = 'P2033';
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
