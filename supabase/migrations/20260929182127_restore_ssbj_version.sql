-- 過去の固定版を、作業中データを変更せず新しい固定版として複製する。
-- 既存の保存 RPC を拡張する。元版の snapshot と basedOnDraftRevision を保持し、
-- 新版には新しい版番号・作成者・作成日時・sourceVersionId を記録する。

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
  v_source ssbj_report_versions%rowtype;
  v_based_on_draft_revision integer;
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
    select * into v_source
    from ssbj_report_versions
    where id = p_source_version_id
      and "reportId" = p_report_id
      and "organizationId" = p_organization_id;
    if not found then
      raise exception '復元元の保存版が見つかりません: %', p_source_version_id
        using errcode = 'P2031';
    end if;
    -- 固定版の内容をそのまま複製する。現在の作業中データは変更しない。
    v_snapshot := v_source.snapshot;
    v_based_on_draft_revision := v_source."basedOnDraftRevision";
  else
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
    v_based_on_draft_revision := v_report."draftRevision";
  end if;

  select coalesce(max("versionNumber"), 0) + 1
    into v_next_version_number
  from ssbj_report_versions
  where "reportId" = p_report_id;

  insert into ssbj_report_versions
    (id, "organizationId", "reportId", "versionNumber", snapshot,
     "basedOnDraftRevision", "sourceVersionId", note, "createdByUserId")
  values
    (gen_random_uuid(), p_organization_id, p_report_id, v_next_version_number, v_snapshot,
     v_based_on_draft_revision, p_source_version_id, p_note, p_actor_user_id)
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
