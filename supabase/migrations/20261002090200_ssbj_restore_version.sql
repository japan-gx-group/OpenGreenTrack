-- SSBJ 開示レポート（試行版 R1）: 保存版の復元（作業中の内容を過去の版に戻す。docs/ssbj-spec.md §10・§13「版の復元」）。
--
-- 過去版から「新しい版」を作る機能（20260929182127_restore_ssbj_version.sql）とは別に、作業中データそのものを
-- 指定した版の内容に戻す。戻す前の作業中の内容は、必ず保存版として自動で残す（復元で失われるものを作らない）。
--
-- 各機能は、保存版への取り込み（ssbj_snapshot_section__<key>）と対になる ssbj_restore_section__<key> を持つ（§10）。
-- 復元 RPC は名前で自動収集する。保存版に、復元の関数が無いセクションがあれば、何も変えずに失敗する（黙って落とさない）。
-- 版にセクションが無い（その機能ができる前の版）ときは、そのセクションの作業中データを空にする（その版の時点の状態に戻す）。

-- §1 セクションごとの復元（service_role 限定。組織・状態・競合の検証は restore_ssbj_report_version が行う）
-- 引数: レポート ID、組織 ID、操作者、版のセクション（無ければ null）。作業中データを消して、版の内容で作り直す。

create function ssbj_restore_section__risks_opportunities(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_risks_opportunities where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'array' then
    return;
  end if;
  -- 並び（作成順）を保つため、版の順に作成日時を進めて入れる。
  insert into ssbj_risks_opportunities
    (id, "organizationId", "reportId", kind, title, "riskTypeState", "riskType",
     "descriptionState", "descriptionText", "internalNote", "timeHorizonState", "timeHorizon", "linkTargets",
     "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
  select
    (e.value ->> 'id')::uuid, p_organization_id, p_report_id, e.value ->> 'kind', e.value ->> 'title',
    -- 種類の無い古い版（リスクの種類を足す前）は未入力として戻す。
    coalesce(e.value -> 'riskType' ->> 'state', 'unanswered')::ssbj_field_state,
    e.value -> 'riskType' ->> 'value',
    (e.value -> 'description' -> 'disclosure' ->> 'state')::ssbj_field_state,
    e.value -> 'description' -> 'disclosure' ->> 'value',
    e.value -> 'description' ->> 'internalNote',
    (e.value -> 'timeHorizon' ->> 'state')::ssbj_field_state,
    e.value -> 'timeHorizon' ->> 'value',
    array(select jsonb_array_elements_text(coalesce(e.value -> 'linkTargets', '[]'::jsonb))),
    p_actor_user_id, p_actor_user_id,
    now() + make_interval(secs => e.ordinality / 1000.0), now() + make_interval(secs => e.ordinality / 1000.0)
  from jsonb_array_elements(p_section) with ordinality as e(value, ordinality);
end;
$$;

create function ssbj_restore_section__time_horizons(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_report_time_horizons where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'object' then
    return;
  end if;
  insert into ssbj_report_time_horizons
    ("reportId", "organizationId",
     "shortTermState", "shortTerm", "mediumTermState", "mediumTerm", "longTermState", "longTerm",
     "planningHorizonRelationState", "planningHorizonRelation", "internalNote",
     "createdByUserId", "updatedByUserId")
  values
    (p_report_id, p_organization_id,
     (p_section -> 'shortTerm' ->> 'state')::ssbj_field_state, p_section -> 'shortTerm' ->> 'value',
     (p_section -> 'mediumTerm' ->> 'state')::ssbj_field_state, p_section -> 'mediumTerm' ->> 'value',
     (p_section -> 'longTerm' ->> 'state')::ssbj_field_state, p_section -> 'longTerm' ->> 'value',
     (p_section -> 'planningHorizonRelation' ->> 'state')::ssbj_field_state,
     p_section -> 'planningHorizonRelation' ->> 'value',
     p_section ->> 'internalNote',
     p_actor_user_id, p_actor_user_id);
end;
$$;

create function ssbj_restore_section__evidence(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_evidence where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'array' then
    return;
  end if;
  insert into ssbj_evidence
    (id, "organizationId", "reportId", "itemId", "documentTitle", "documentVersion", "internalLocation",
     "referencePosition", "ownerDepartment", "disclosureState", "disclosureText",
     "createdByUserId", "updatedByUserId", "createdAt", "updatedAt")
  select
    (e.value ->> 'id')::uuid, p_organization_id, p_report_id, e.value ->> 'itemId', e.value ->> 'documentTitle',
    e.value ->> 'documentVersion', e.value ->> 'internalLocation', e.value ->> 'referencePosition',
    e.value ->> 'ownerDepartment',
    (e.value -> 'disclosure' ->> 'state')::ssbj_field_state, e.value -> 'disclosure' ->> 'value',
    p_actor_user_id, p_actor_user_id,
    now() + make_interval(secs => e.ordinality / 1000.0), now() + make_interval(secs => e.ordinality / 1000.0)
  from jsonb_array_elements(p_section) with ordinality as e(value, ordinality);
end;
$$;

create function ssbj_restore_section__ghg(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_ogt_adoptions where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'object' then
    return;
  end if;
  -- 採用した値・採用日時・採用者は、版に残っているものをそのまま戻す（OGT の最新値を取り直さない）。
  insert into ssbj_ogt_adoptions
    ("organizationId", "reportId", "adoptedValues", "supplierReferences", "adoptedAt", "adoptedByUserId")
  values
    (p_organization_id, p_report_id, p_section -> 'values', coalesce(p_section -> 'supplierReferences', '[]'::jsonb),
     (p_section ->> 'adoptedAt')::timestamptz, (p_section ->> 'adoptedBy')::uuid);
end;
$$;

create function ssbj_restore_section__narratives(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_narratives where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'array' then
    return;
  end if;
  insert into ssbj_narratives
    ("organizationId", "reportId", "itemId", "disclosureState", "disclosureText", "internalNote",
     "createdByUserId", "updatedByUserId")
  select
    p_organization_id, p_report_id, e.value ->> 'itemId',
    (e.value -> 'text' -> 'disclosure' ->> 'state')::ssbj_field_state, e.value -> 'text' -> 'disclosure' ->> 'value',
    e.value -> 'text' ->> 'internalNote',
    p_actor_user_id, p_actor_user_id
  from jsonb_array_elements(p_section) as e(value);
end;
$$;

create function ssbj_restore_section__judgements(
  p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_section jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from ssbj_judgements where "reportId" = p_report_id;
  if p_section is null or jsonb_typeof(p_section) <> 'array' then
    return;
  end if;
  insert into ssbj_judgements
    ("organizationId", "reportId", "requirementId", applicability, materiality, "omissionReason",
     "explanationState", "explanationText", "internalReason", "createdByUserId", "updatedByUserId")
  select
    p_organization_id, p_report_id, e.value ->> 'requirementId', e.value ->> 'applicability',
    e.value ->> 'materiality', e.value ->> 'omissionReason',
    (e.value -> 'explanation' -> 'disclosure' ->> 'state')::ssbj_field_state,
    e.value -> 'explanation' -> 'disclosure' ->> 'value',
    e.value -> 'explanation' ->> 'internalNote',
    p_actor_user_id, p_actor_user_id
  from jsonb_array_elements(p_section) as e(value);
end;
$$;

revoke execute on function ssbj_restore_section__risks_opportunities(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function ssbj_restore_section__time_horizons(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function ssbj_restore_section__evidence(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function ssbj_restore_section__ghg(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function ssbj_restore_section__narratives(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function ssbj_restore_section__judgements(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function ssbj_restore_section__risks_opportunities(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function ssbj_restore_section__time_horizons(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function ssbj_restore_section__evidence(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function ssbj_restore_section__ghg(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function ssbj_restore_section__narratives(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function ssbj_restore_section__judgements(uuid, uuid, uuid, jsonb) to service_role;

-- §2 復元 RPC（service_role 限定。Route Handler から呼ぶ）
-- エラー: P2031 = レポート・版が無い・組織不一致 / P2033 = draftRevision の競合 / P2051 = 承認済み /
--         P2055 = 版の形式が不正、または復元できないセクションを含む

create function restore_ssbj_report_version(
  p_report_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_version_id uuid,
  p_expected_draft_revision integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report ssbj_reports%rowtype;
  v_version ssbj_report_versions%rowtype;
  v_backup jsonb;
  v_restorers text[];
  v_key text;
  v_fn text;
  v_snapshot_report jsonb;
begin
  select * into v_report from ssbj_reports where id = p_report_id for update;
  if not found or v_report."organizationId" <> p_organization_id then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;
  if v_report.status = 'approved' then
    raise exception '承認済みのレポートは変更できません。変更するには、管理者か承認者が差戻してください'
      using errcode = 'P2051';
  end if;
  if v_report."draftRevision" <> p_expected_draft_revision then
    raise exception '他の変更と競合しました。画面を開き直してください（現在の draftRevision % ≠ 画面が保持していた %）',
      v_report."draftRevision", p_expected_draft_revision
      using errcode = 'P2033';
  end if;

  select * into v_version
  from ssbj_report_versions
  where id = p_version_id and "reportId" = p_report_id and "organizationId" = p_organization_id;
  if not found then
    raise exception '復元する保存版が見つかりません: %', p_version_id using errcode = 'P2031';
  end if;
  if (v_version.snapshot ->> 'schemaVersion') is distinct from '1'
     or jsonb_typeof(v_version.snapshot -> 'sections') <> 'object'
     or jsonb_typeof(v_version.snapshot -> 'report') <> 'object' then
    raise exception '対応していない保存版の形式です' using errcode = 'P2055';
  end if;

  select array_agg(substring(p.proname from length('ssbj_restore_section__') + 1) order by p.proname)
    into v_restorers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'ssbj\_restore\_section\_\_%' escape '\';

  -- 復元できないセクション（後から加わった機能で、復元の関数が無いもの）を含む版は、何も変えずに止める。
  for v_key in select jsonb_object_keys(v_version.snapshot -> 'sections') loop
    if not (v_key = any (coalesce(v_restorers, array[]::text[]))) then
      raise exception 'この保存版には復元できない項目があります: %', v_key using errcode = 'P2055';
    end if;
  end loop;

  perform set_config('ssbj.actor_user_id', p_actor_user_id::text, true);

  -- 戻す前の作業中の内容を、保存版として残す。
  v_backup := create_ssbj_report_version(
    p_report_id, p_organization_id, p_actor_user_id, p_expected_draft_revision,
    format('版 %s を復元する前の自動保存', v_version."versionNumber"), null
  );

  -- 行ごとの操作履歴は止め、復元として 1 件だけ記録する。
  perform set_config('ssbj.suppress_audit', 'on', true);

  foreach v_key in array coalesce(v_restorers, array[]::text[]) loop
    v_fn := 'ssbj_restore_section__' || v_key;
    execute format('select %I($1, $2, $3, $4)', v_fn)
      using p_report_id, p_organization_id, p_actor_user_id, v_version.snapshot -> 'sections' -> v_key;
  end loop;

  -- 基本情報も版の内容に戻す（年度は作成後に変えないため戻さない）。
  v_snapshot_report := v_version.snapshot -> 'report';
  update ssbj_reports
  set title = v_snapshot_report ->> 'title',
      purpose = v_snapshot_report ->> 'purpose',
      "reportingScope" = v_snapshot_report ->> 'reportingScope',
      "standardVersion" = v_snapshot_report ->> 'standardVersion',
      "parentCompanyName" = v_snapshot_report ->> 'parentCompanyName',
      "parentRelationship" = v_snapshot_report ->> 'parentRelationship',
      "ownershipPercentage" = (v_snapshot_report ->> 'ownershipPercentage')::numeric,
      "measurementApproach" = v_snapshot_report ->> 'measurementApproach',
      "industryCode" = v_snapshot_report ->> 'industryCode',
      "updatedByUserId" = p_actor_user_id
  where id = p_report_id;

  perform set_config('ssbj.suppress_audit', '', true);

  insert into ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", details)
  values
    (p_organization_id, p_report_id, p_actor_user_id, 'version_restore', 'version', p_version_id::text,
     jsonb_build_object(
       'versionNumber', v_version."versionNumber",
       'backupVersionId', v_backup ->> 'id',
       'backupVersionNumber', (v_backup ->> 'versionNumber')::integer
     ));

  return jsonb_build_object(
    'restoredVersionNumber', v_version."versionNumber",
    'backupVersionId', v_backup ->> 'id',
    'backupVersionNumber', (v_backup ->> 'versionNumber')::integer,
    'draftRevision', (select "draftRevision" from ssbj_reports where id = p_report_id)
  );
end;
$$;

comment on function restore_ssbj_report_version(uuid, uuid, uuid, uuid, integer) is
  '作業中の内容を指定した保存版の内容に戻す（戻す前の内容は保存版として自動で残す）。service_role 限定。'
  'P2031 = 不在・組織不一致 / P2033 = 競合 / P2051 = 承認済み / P2055 = 形式が不正・復元できない項目を含む。';

revoke execute on function restore_ssbj_report_version(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function restore_ssbj_report_version(uuid, uuid, uuid, uuid, integer) to service_role;
