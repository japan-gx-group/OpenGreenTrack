-- SSBJ レポートの印刷・PDF 保存を、操作履歴（ssbj_audit_logs）にファイルの出力として記録する。
--
-- record_ssbj_export（20261023100000_ssbj_role_policies.sql）を置き換え、出力形式に 'print' を加える。
-- 引数・戻り値・権限の形は同じ。印刷はブラウザの機能（window.print()）で行うため、記録するのは「印刷のダイアログを開いた」
-- 時点で、実際に印刷・保存したか（取り消したか）は区別できない。画面はこのことを操作履歴に注記する。
--
-- 閲覧者は、CSV / Excel と同じく承認した保存版の印刷だけを記録できる（閲覧者の印刷ビューは承認した版だけを表示する）。
-- エラー: P2031 = レポート・版が無い（見えない）、P2061 = 形式が不正。

create or replace function record_ssbj_export(p_report_id uuid, p_format text, p_version_id uuid default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_version_number integer;
  v_id bigint;
begin
  if p_format not in ('csv', 'xlsx', 'audit_csv', 'audit_xlsx', 'print') then
    raise exception '出力形式が不正です: %', p_format using errcode = 'P2061';
  end if;

  select r."organizationId" into v_organization_id
  from public.ssbj_reports r
  where r.id = p_report_id
    and r."organizationId" = public.current_user_organization_id();
  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;

  if p_version_id is not null then
    select v."versionNumber" into v_version_number
    from public.ssbj_report_versions v
    where v.id = p_version_id and v."reportId" = p_report_id;
    if not found then
      raise exception '保存版が見つかりません: %', p_version_id using errcode = 'P2031';
    end if;
  end if;

  -- 閲覧者は、承認済みのレポートの承認した保存版の CSV / Excel / 印刷だけ（作業中・未承認の版・操作履歴は見えないため）。
  if not public.ssbj_current_user_can_view_working() and (
    p_format not in ('csv', 'xlsx', 'print')
    or p_version_id is null
    or not exists (
      select 1 from public.ssbj_reports r
      where r.id = p_report_id and r.status = 'approved' and r."approvedVersionId" = p_version_id
    )
  ) then
    raise exception '保存版が見つかりません: %', coalesce(p_version_id::text, p_report_id::text) using errcode = 'P2031';
  end if;

  insert into public.ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", details)
  values
    (v_organization_id, p_report_id, auth.uid(), 'export',
     case when p_version_id is null then 'report' else 'version' end,
     coalesce(p_version_id::text, p_report_id::text),
     jsonb_strip_nulls(jsonb_build_object('format', p_format, 'versionNumber', v_version_number)))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function record_ssbj_export(uuid, text, uuid) is
  'SSBJ のファイル出力（CSV / Excel / 操作履歴の出力 / 印刷・PDF 保存）を操作履歴に記録する。自組織のレポートだけ。'
  '閲覧者は承認した版の CSV / Excel / 印刷だけ。印刷は印刷のダイアログを開いた時点の記録で、実際に印刷したかは区別できない。'
  'P2031 = レポート・版が無い（見えない）、P2061 = 形式が不正。';

revoke execute on function record_ssbj_export(uuid, text, uuid) from public, anon;
grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;
