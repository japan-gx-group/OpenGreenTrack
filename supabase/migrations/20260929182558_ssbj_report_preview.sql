-- SSBJ 開示レポート（試行版 R1）: 作業中の内容のプレビュー（T12。docs/ssbj-spec.md §8）。
--
-- プレビューの「作業中」表示は、保存版とまったく同じ形（SsbjReportSnapshotV1）で作業中データを組み立てて返す。
-- 形を保存版と一致させるため、スナップショットの組み立てを ssbj_build_report_snapshot に切り出し、
-- 版生成 RPC（create_ssbj_report_version）もこれを使うように置き換える（振る舞いは変えない。
-- 過去版からの新版作成（20260929182127_restore_ssbj_version.sql）で入った「元版のスナップショットを
-- そのまま複製する」処理も残す）。
-- 組み立てを 2 か所に書くと、基本情報の項目を足したときなどに片方だけ直す事故が起きるため。

-- §1 スナップショットの組み立て（service_role 限定。組織の検証は呼び出し側の RPC が行う）

create function ssbj_build_report_snapshot(p_report_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_report ssbj_reports%rowtype;
  v_fiscal_year_label text;
  v_period_start date;
  v_period_end date;
  v_sections jsonb := '{}'::jsonb;
  v_fn record;
  v_key text;
  v_section jsonb;
begin
  select * into v_report from ssbj_reports where id = p_report_id;
  if not found then
    return null;
  end if;

  select label, "startDate", "endDate"
    into v_fiscal_year_label, v_period_start, v_period_end
  from fiscal_years
  where id = v_report."fiscalYearId";

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

  -- SsbjReportSnapshotV1 と同じ形（src/features/ssbj/types.ts）。年度のラベル・期間は作成時点の表記を複写する。
  return jsonb_build_object(
    'schemaVersion', 1,
    'report', jsonb_build_object(
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
    ),
    'sections', v_sections
  );
end;
$$;

comment on function ssbj_build_report_snapshot(uuid) is
  'SSBJ レポートの作業中データを保存版と同じ形（SsbjReportSnapshotV1）に組み立てる。'
  'create_ssbj_report_version と preview_ssbj_report が使う。service_role 限定（組織の検証は呼び出し側）。';

revoke execute on function ssbj_build_report_snapshot(uuid) from public, anon, authenticated;
grant execute on function ssbj_build_report_snapshot(uuid) to service_role;

-- §2 版生成 RPC を組み立て関数を使う形に置き換える（引数・検証・採番・戻り値と、過去版の複製は変えない）

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
    v_snapshot := ssbj_build_report_snapshot(p_report_id);
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

-- §3 作業中の内容のプレビュー（Route Handler から service_role で呼ぶ）
-- service_role は RLS を越えるため、組織の一致をここで検証する（Route Handler のバグで他組織を見せないため）。

create function preview_ssbj_report(p_report_id uuid, p_organization_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_draft_revision integer;
begin
  select "draftRevision" into v_draft_revision
  from ssbj_reports
  where id = p_report_id
    and "organizationId" = p_organization_id;

  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id
      using errcode = 'P2031';
  end if;

  return jsonb_build_object(
    'draftRevision', v_draft_revision,
    'snapshot', ssbj_build_report_snapshot(p_report_id)
  );
end;
$$;

comment on function preview_ssbj_report(uuid, uuid) is
  '作業中の内容を保存版と同じ形で返す（保存はしない）。service_role 限定。P2031 = レポートが無い・組織不一致。';

revoke execute on function preview_ssbj_report(uuid, uuid) from public, anon, authenticated;
grant execute on function preview_ssbj_report(uuid, uuid) to service_role;
