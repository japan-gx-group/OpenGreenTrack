-- SSBJ 開示レポート（試行版 R1）: 操作履歴（docs/ssbj-spec.md §13「操作履歴」）。
--
-- SSBJ のデータの作成・更新・削除、状態の変更、保存版の作成・復元、ファイルの出力を、誰がいつ行ったかを自動で記録する。
-- 行の変更はトリガーで記録するため、画面・API・PostgREST のどこから変えても漏れない。
-- 状態の変更・復元は、それぞれの RPC が 1 件ずつ記録する（行ごとの記録は止める。ssbj.suppress_audit）。
-- 履歴は書き換えない（update はトリガーで全ロール拒否、delete は権限を与えない。レポートの削除でだけ連鎖削除される）。
-- OGT 本体の system_audit_logs には手を入れない（CSV の出力記録はこれまでどおりそちらにも書く）。

-- §1 テーブル

create table ssbj_audit_logs (
  id bigint generated always as identity primary key,
  "organizationId" uuid not null references organizations(id) on delete cascade,
  -- レポートの削除（デモデータの入れ直し・テストの後片付け）では、そのレポートの履歴も消える。
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  -- 操作した人。service_role の処理は、呼び出し元が ssbj.actor_user_id に渡した人を記録する。
  "actorUserId" uuid,
  action varchar(30) not null,
  -- 対象の種類（report / narrative / judgement / risk_opportunity / time_horizons / evidence / ogt_adoption / version）。
  "targetType" varchar(30) not null,
  -- 対象の識別子（行 ID・項目 ID・要求 ID など）。
  "targetId" text,
  -- update で変わった列（監査列・版数は含めない）。
  "changedColumns" text[],
  -- 操作ごとの補足（状態の前後・版番号・出力形式・対象の名前など）。
  details jsonb not null default '{}'::jsonb,
  "createdAt" timestamptz not null default clock_timestamp(),
  constraint ssbj_audit_logs_action_check check (
    action in ('create', 'update', 'delete', 'status_change', 'version_create', 'version_restore', 'export')
  ),
  constraint ssbj_audit_logs_details_is_object check (jsonb_typeof(details) = 'object')
);

comment on table ssbj_audit_logs is
  'SSBJ レポートの操作履歴（誰が・いつ・何をしたか）。トリガーと RPC だけが書き、書き換えない。docs/ssbj-spec.md §13。';

create index ssbj_audit_logs_report_idx on ssbj_audit_logs ("reportId", id desc);
create index ssbj_audit_logs_organization_idx on ssbj_audit_logs ("organizationId");

-- §2 書き換えの拒否（service_role を含む全ロール）

create function reject_ssbj_audit_log_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ssbj_audit_logs は書き換えできません（操作履歴）' using errcode = 'P2060';
end;
$$;

create trigger reject_ssbj_audit_logs_update
before update on ssbj_audit_logs
for each row execute function reject_ssbj_audit_log_update();

-- §3 行の変更を記録するトリガー関数
-- 引数: tg_argv[0] = 対象の種類、tg_argv[1] = 対象の識別子の列、tg_argv[2]（任意）= 画面に出す名前の列。
-- security definer: 記録先は利用者が書けないテーブルのため。記録するのは、呼び出し元テーブルの RLS を通った行だけ。

create function ssbj_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_report_id uuid;
  v_action text;
  v_changed text[];
  v_actor uuid;
  v_details jsonb := '{}'::jsonb;
  -- 版数・監査列・状態の列は、内容の変更として記録しない（状態の変更は RPC が別に記録する）。
  v_ignored text[] := array[
    'updatedAt', 'updatedByUserId', 'draftRevision', 'status', 'approverUserId', 'approvedAt',
    'approvedByUserId', 'approvedVersionId', 'statusChangedAt', 'statusChangedByUserId'
  ];
begin
  if coalesce(current_setting('ssbj.suppress_audit', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  if tg_table_name = 'ssbj_reports' then
    v_report_id := (v_row ->> 'id')::uuid;
  else
    v_report_id := (v_row ->> 'reportId')::uuid;
  end if;

  -- レポートの削除に伴う連鎖削除では記録しない（記録先の外部キーが消えるレポートを指すため）。
  if not exists (select 1 from public.ssbj_reports r where r.id = v_report_id) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_action := case when tg_table_name = 'ssbj_report_versions' then 'version_create' else 'create' end;
  elsif tg_op = 'DELETE' then
    v_action := 'delete';
  else
    v_action := 'update';
    v_old := to_jsonb(old);
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_row) as n(key, value)
    where not (key = any (v_ignored))
      and n.value is distinct from (v_old -> key);
    -- 版数・監査列だけが変わった更新（各機能の変更に伴う draftRevision の繰り上げなど）は記録しない。
    if v_changed is null then
      return null;
    end if;
  end if;

  v_actor := coalesce(
    auth.uid(),
    nullif(current_setting('ssbj.actor_user_id', true), '')::uuid,
    (v_row ->> 'updatedByUserId')::uuid,
    (v_row ->> 'adoptedByUserId')::uuid,
    (v_row ->> 'createdByUserId')::uuid
  );

  if tg_nargs > 2 and v_row ? tg_argv[2] then
    v_details := jsonb_build_object('label', v_row ->> tg_argv[2]);
  end if;
  if tg_table_name = 'ssbj_report_versions' then
    v_details := jsonb_build_object(
      'versionNumber', (v_row ->> 'versionNumber')::integer,
      'sourceVersionId', v_row -> 'sourceVersionId',
      'note', v_row -> 'note'
    );
  end if;

  insert into public.ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", "changedColumns", details)
  values
    ((v_row ->> 'organizationId')::uuid, v_report_id, v_actor, v_action, tg_argv[0], v_row ->> tg_argv[1], v_changed, v_details);

  return null;
end;
$$;

comment on function ssbj_audit_row_change() is
  'SSBJ の各テーブルの AFTER INSERT/UPDATE/DELETE に付ける操作履歴のトリガー。ssbj.suppress_audit = on の間は記録しない。';

-- §4 各テーブルへの取り付け（SSBJ のテーブルを足したら、ここと同じ形で取り付ける）

create trigger audit_ssbj_reports
after insert or update on ssbj_reports
for each row execute function ssbj_audit_row_change('report', 'id', 'title');

create trigger audit_ssbj_report_versions
after insert on ssbj_report_versions
for each row execute function ssbj_audit_row_change('version', 'id');

create trigger audit_ssbj_risks_opportunities
after insert or update or delete on ssbj_risks_opportunities
for each row execute function ssbj_audit_row_change('risk_opportunity', 'id', 'title');

create trigger audit_ssbj_report_time_horizons
after insert or update or delete on ssbj_report_time_horizons
for each row execute function ssbj_audit_row_change('time_horizons', 'reportId');

create trigger audit_ssbj_evidence
after insert or update or delete on ssbj_evidence
for each row execute function ssbj_audit_row_change('evidence', 'id', 'documentTitle');

create trigger audit_ssbj_ogt_adoptions
after insert or update or delete on ssbj_ogt_adoptions
for each row execute function ssbj_audit_row_change('ogt_adoption', 'reportId');

create trigger audit_ssbj_narratives
after insert or update or delete on ssbj_narratives
for each row execute function ssbj_audit_row_change('narrative', 'itemId');

create trigger audit_ssbj_judgements
after insert or update or delete on ssbj_judgements
for each row execute function ssbj_audit_row_change('judgement', 'requirementId');

-- §5 ファイルの出力の記録（利用者の画面から呼ぶ）
-- 出力はブラウザで行うため、出力の直前に画面がこの関数を呼ぶ。記録できなければ画面は出力を中止する。

create function record_ssbj_export(p_report_id uuid, p_format text, p_version_id uuid default null)
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
  if p_format not in ('csv', 'xlsx', 'audit_csv', 'audit_xlsx') then
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
  'SSBJ のファイル出力（CSV / Excel / 操作履歴の出力）を操作履歴に記録する。自組織のレポートだけ。P2031 = レポート・版が無い、P2061 = 形式が不正。';

revoke execute on function record_ssbj_export(uuid, text, uuid) from public, anon;
grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;

-- §6 RLS と権限（閲覧だけ。書き込みはトリガーと上の関数だけ）

alter table ssbj_audit_logs enable row level security;

create policy "ssbj_audit_logs_select_own_organization"
on ssbj_audit_logs
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

grant select on ssbj_audit_logs to authenticated;
-- service_role へは 20260831000001_rls.sql §4.4 の default privileges で自動付与される。
