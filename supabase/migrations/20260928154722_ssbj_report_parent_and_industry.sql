-- SSBJ 開示レポート（試行版 R1）: 基本情報に親会社との関係・測定アプローチ・業種を追加する
-- （docs/ssbj-r1-scope.md §2・§6・§9）。
--
-- R1 のレポートは、親会社の有価証券報告書に向けて子会社・関連会社の分を提出する下地になる。
-- 親会社が連結の開示に合算・統合できるよう、親会社名・親会社との関係・持分比率・測定アプローチ
-- （気候関連開示基準 第60項）を持つ。業種は産業別ガイダンスの参照先（SICS コード。第16・17・86項）を示す。
-- いずれも任意項目で、既存行は NULL のまま残す（マイグレーションでデータを埋めない。R12）。

-- §1 列

alter table ssbj_reports
  add column "parentCompanyName" varchar(200),
  add column "parentRelationship" varchar(40),
  add column "ownershipPercentage" numeric(5, 2),
  add column "measurementApproach" varchar(40),
  add column "industryCode" varchar(10);

alter table ssbj_reports
  add constraint ssbj_reports_parent_company_name_not_blank check (
    "parentCompanyName" is null or btrim("parentCompanyName") <> ''
  ),
  add constraint ssbj_reports_parent_relationship_check check (
    "parentRelationship" in (
      'consolidated_subsidiary', 'non_consolidated_subsidiary', 'equity_method_affiliate', 'other'
    )
  ),
  add constraint ssbj_reports_ownership_percentage_check check (
    "ownershipPercentage" > 0 and "ownershipPercentage" <= 100
  ),
  -- 気候関連開示基準 第60項の 3 つの測定アプローチ
  add constraint ssbj_reports_measurement_approach_check check (
    "measurementApproach" in ('equity_share', 'operational_control', 'financial_control')
  ),
  -- SICS の 68 産業（産業別ガイダンスの巻）。一覧は src/features/ssbj/utils/sicsIndustries.ts と一致させる。
  add constraint ssbj_reports_industry_code_check check (
    "industryCode" in (
      'CG-AA', 'CG-AM', 'CG-BF', 'CG-EC', 'CG-HP', 'CG-MR',
      'EM-CO', 'EM-CM', 'EM-IS', 'EM-MM', 'EM-EP', 'EM-MD', 'EM-RM', 'EM-SV',
      'FN-AC', 'FN-CB', 'FN-IN', 'FN-IB', 'FN-MF',
      'FB-AG', 'FB-AB', 'FB-FR', 'FB-MP', 'FB-NB', 'FB-PF', 'FB-RN',
      'HC-DR', 'HC-DY', 'HC-DI', 'HC-MC', 'HC-MS',
      'IF-EU', 'IF-EN', 'IF-GU', 'IF-HB', 'IF-RE', 'IF-RS', 'IF-WM', 'IF-WU',
      'RR-BI', 'RR-FM', 'RR-FC', 'RR-PP', 'RR-ST', 'RR-WT',
      'RT-AE', 'RT-CH', 'RT-CP', 'RT-EE', 'RT-IG',
      'SV-CA', 'SV-HL', 'SV-LF',
      'TC-ES', 'TC-HW', 'TC-IM', 'TC-SC', 'TC-SI', 'TC-TL',
      'TR-AF', 'TR-AL', 'TR-AP', 'TR-AU', 'TR-CR', 'TR-CL', 'TR-MT', 'TR-RA', 'TR-RO'
    )
  );

comment on column ssbj_reports."parentCompanyName" is '親会社名（任意）。レポートの提出先。';
comment on column ssbj_reports."parentRelationship" is
  '親会社との関係（任意）: 連結子会社 / 非連結子会社 / 持分法適用関連会社 / その他。';
comment on column ssbj_reports."ownershipPercentage" is
  '親会社の持分比率（%、任意）。親会社が持分割合アプローチで集計する場合に使う。';
comment on column ssbj_reports."measurementApproach" is
  '温室効果ガス排出の測定アプローチ（任意）: 持分割合 / 経営支配力 / 財務支配力（気候関連開示基準 第60項）。親会社の選択に合わせる。';
comment on column ssbj_reports."industryCode" is
  '業種（任意）。SICS の産業コード（例 RT-IG）。産業別ガイダンスの参照先を示す。';

-- §2 GRANT（基本情報の列として作成時・編集時に書ける）

grant insert (
  "parentCompanyName",
  "parentRelationship",
  "ownershipPercentage",
  "measurementApproach",
  "industryCode"
), update (
  "parentCompanyName",
  "parentRelationship",
  "ownershipPercentage",
  "measurementApproach",
  "industryCode"
) on ssbj_reports to authenticated;

-- §3 基本情報の変更で draftRevision を進める対象に、追加した列を含める
-- （関数名・引数は変えない。create or replace は既存のトリガーと権限を保つ）。

create or replace function bump_ssbj_reports_own_draft_revision()
returns trigger
language plpgsql
as $$
begin
  if (new.title is distinct from old.title)
     or (new.purpose is distinct from old.purpose)
     or (new."reportingScope" is distinct from old."reportingScope")
     or (new."standardVersion" is distinct from old."standardVersion")
     or (new."parentCompanyName" is distinct from old."parentCompanyName")
     or (new."parentRelationship" is distinct from old."parentRelationship")
     or (new."ownershipPercentage" is distinct from old."ownershipPercentage")
     or (new."measurementApproach" is distinct from old."measurementApproach")
     or (new."industryCode" is distinct from old."industryCode") then
    new."draftRevision" := old."draftRevision" + 1;
  end if;
  return new;
end;
$$;

-- §4 保存版の report に追加した列を含める（SsbjReportRecord と同じ形。src/features/ssbj/types.ts）。
-- 持分比率は十進表記の文字列で入れる（数値にすると桁の表記が揺れるため。docs/ssbj-spec.md §6）。
-- 関数名・引数・処理の流れは 20260927180425_ssbj_report_versions.sql と同じで、report の項目だけを足している。

create or replace function create_ssbj_report_version(
  p_report_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_expected_draft_revision integer,
  p_note text default null,
  p_source_version_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report ssbj_reports%rowtype;
  v_fiscal_year_label text;
  v_period_start date;
  v_period_end date;
  v_report_json jsonb;
  v_sections jsonb := '{}'::jsonb;
  v_fn record;
  v_key text;
  v_section jsonb;
  v_next_version_number integer;
  v_version_id uuid;
  v_snapshot jsonb;
begin
  -- レポート行をロックし、組織帰属と draftRevision の一致を確認する（§8 の競合防止）。
  select * into v_report
  from ssbj_reports
  where id = p_report_id
  for update;

  if not found or v_report."organizationId" <> p_organization_id then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id
      using errcode = 'P2031';
  end if;

  if v_report."draftRevision" <> p_expected_draft_revision then
    raise exception '他の変更と競合しました。画面を開き直してください（現在の draftRevision % ≠ 画面が保持していた %）',
      v_report."draftRevision", p_expected_draft_revision
      using errcode = 'P2033';
  end if;

  if p_source_version_id is not null then
    perform 1 from ssbj_report_versions
    where id = p_source_version_id and "reportId" = p_report_id;
    if not found then
      raise exception '復元元の保存版が見つかりません: %', p_source_version_id
        using errcode = 'P2031';
    end if;
  end if;

  select label, "startDate", "endDate"
    into v_fiscal_year_label, v_period_start, v_period_end
  from fiscal_years
  where id = v_report."fiscalYearId";

  -- SsbjReportRecord と同じ形（src/features/ssbj/types.ts）。年度のラベル・期間は作成時点の表記を複写する。
  v_report_json := jsonb_build_object(
    'id', v_report.id,
    'organizationId', v_report."organizationId",
    'fiscalYearId', v_report."fiscalYearId",
    'title', v_report.title,
    'purpose', v_report.purpose,
    'reportingScope', v_report."reportingScope",
    'standardVersion', v_report."standardVersion",
    'parentCompanyName', v_report."parentCompanyName",
    'parentRelationship', v_report."parentRelationship",
    'ownershipPercentage', v_report."ownershipPercentage"::text,
    'measurementApproach', v_report."measurementApproach",
    'industryCode', v_report."industryCode",
    'createdAt', v_report."createdAt",
    'updatedAt', v_report."updatedAt",
    'fiscalYearLabel', v_fiscal_year_label,
    'periodStart', v_period_start,
    'periodEnd', v_period_end
  );

  -- 各機能の ssbj_snapshot_section__<key> 関数を名前順に集める（§10）。
  for v_fn in
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'ssbj\_snapshot\_section\_\_%' escape '\'
    order by p.proname
  loop
    v_key := substring(v_fn.proname from length('ssbj_snapshot_section__') + 1);
    execute format('select %I($1)', v_fn.proname) into v_section using p_report_id;
    v_sections := v_sections || jsonb_build_object(v_key, coalesce(v_section, 'null'::jsonb));
  end loop;

  v_snapshot := jsonb_build_object(
    'schemaVersion', 1,
    'report', v_report_json,
    'sections', v_sections
  );

  select coalesce(max("versionNumber"), 0) + 1
    into v_next_version_number
  from ssbj_report_versions
  where "reportId" = p_report_id;

  insert into ssbj_report_versions
    (id, "organizationId", "reportId", "versionNumber", snapshot,
     "basedOnDraftRevision", "sourceVersionId", note, "createdByUserId")
  values
    (gen_random_uuid(), p_organization_id, p_report_id, v_next_version_number, v_snapshot,
     v_report."draftRevision", p_source_version_id, p_note, p_actor_user_id)
  returning id into v_version_id;

  return jsonb_build_object(
    'id', v_version_id,
    'versionNumber', v_next_version_number
  );
end;
$$;

-- create or replace は既存の EXECUTE 権限を保つが、service_role 限定であることを明示しておく。
revoke execute on function create_ssbj_report_version(uuid, uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function create_ssbj_report_version(uuid, uuid, uuid, integer, text, uuid) to service_role;
