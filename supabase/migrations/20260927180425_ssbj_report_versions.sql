-- SSBJ 開示レポート（試行版 R1）: 汎用の保存・版生成基盤（docs/ssbj-spec.md §4・§8〜§10）。
--
-- ここで用意するのは「作業中データ（編集可）」と「固定版（書き換え不可）」の2層を実現する仕組みそのもの。
-- 各機能（T05 文章 / T07 リスク・機会 / T08b OGT採用値 / T09 判断 / T10 根拠）のテーブルは知らず、
-- 命名規約（ssbj_snapshot_section__<key>）で自動収集する（§10）。責務の方向は T04 → T06 → 各機能（§9）。

-- §1 値の状態（enum。§4。各機能のテーブルがこの enum ＋値列の対で状態を持つ）

create type "ssbj_field_state" as enum ('unanswered', 'unconfirmed', 'not_applicable', 'answered');

comment on type "ssbj_field_state" is
  '入力欄の状態（docs/ssbj-spec.md §4）。answered のときだけ対になる値列が非 NULL になる（各機能の check 制約で担保）。';

-- §2 作業中データ側: ssbj_reports に draftRevision を追加

alter table ssbj_reports add column "draftRevision" integer not null default 1;

comment on column ssbj_reports."draftRevision" is
  '作業中データの版数。自分の基本情報の変更、および各機能テーブルの変更（bump_ssbj_draft_revision 経由）のたびに +1 する。'
  '保存版（ssbj_report_versions）はこの値をスナップショット生成時点の basedOnDraftRevision として記録し、'
  '保存操作時にクライアントが保持する値と突き合わせて競合を検知する（§8）。';

-- ssbj_reports 自身の基本情報の変更を draftRevision に反映する。
-- BEFORE UPDATE で NEW を書き換えるため、authenticated の列 GRANT（title/purpose/reportingScope/standardVersion のみ）に
-- draftRevision が含まれていなくても書ける（set_ssbj_reports_updated_at が updatedAt を書けるのと同じ理由）。
create function bump_ssbj_reports_own_draft_revision()
returns trigger
language plpgsql
as $$
begin
  if (new.title is distinct from old.title)
     or (new.purpose is distinct from old.purpose)
     or (new."reportingScope" is distinct from old."reportingScope")
     or (new."standardVersion" is distinct from old."standardVersion") then
    new."draftRevision" := old."draftRevision" + 1;
  end if;
  return new;
end;
$$;

-- 同一イベントの before トリガーは名前順に起動する。set_ssbj_reports_actor / set_ssbj_reports_updated_at
-- （20260927170328_ssbj_reports.sql）より先に走るが、両者は old/new の title 等を書き換えないため順序に依存しない。
create trigger bump_ssbj_reports_draft_revision
before update on ssbj_reports
for each row execute function bump_ssbj_reports_own_draft_revision();

-- 各機能（T05・T07・T08b・T09・T10）のテーブルが AFTER INSERT/UPDATE/DELETE で付ける共通トリガー関数（§10 の手順2）。
-- 対象テーブルは "reportId" 列を持つ前提（§10 の手順1）。
--
-- security definer: 呼び出し元（authenticated）は自分の機能テーブルへの書き込み権限しか持たず、
-- ssbj_reports.draftRevision の列 GRANT も持たない。他組織の draftRevision を書き換えられないよう、
-- 対象は new/old."reportId" の行だけに限定する（他組織の reportId を渡しても RLS で自機能テーブル側の
-- insert/update/delete 自体が先に拒否されるため、ここに到達する時点で自組織の reportId であることは
-- 呼び出し元テーブルの RLS が担保している）。
create function bump_ssbj_draft_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
begin
  if tg_op = 'DELETE' then
    v_report_id := old."reportId";
  else
    v_report_id := new."reportId";
  end if;

  update public.ssbj_reports
  set "draftRevision" = "draftRevision" + 1
  where id = v_report_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function bump_ssbj_draft_revision() is
  '各機能テーブルの AFTER INSERT/UPDATE/DELETE に付ける共通トリガー。対象行の "reportId" が指す '
  'ssbj_reports.draftRevision を +1 する。各機能はこの関数を書き換えず、自分のテーブルに付けるだけにする（docs/ssbj-spec.md §10）。';

-- §3 固定版: ssbj_report_versions（不変のスナップショット。§8）

create table ssbj_report_versions (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid not null references organizations(id) on delete cascade,
  "reportId" uuid not null references ssbj_reports(id) on delete cascade,
  -- レポート内の連番（1始まり）。採番は create_ssbj_report_version 内で行い、アプリ側では生成しない。
  "versionNumber" integer not null,
  -- SsbjReportSnapshotV1（{ schemaVersion, report, sections }）。形式を変えるときは schemaVersion を上げる。
  snapshot jsonb not null,
  -- どの作業状態（ssbj_reports.draftRevision）から作った版か。
  "basedOnDraftRevision" integer not null,
  -- 過去版から作った場合の元の版（T11 の復元）。通常の保存では null。
  "sourceVersionId" uuid references ssbj_report_versions(id),
  note text,
  "createdByUserId" uuid,
  "createdAt" timestamptz not null default now(),
  constraint ssbj_report_versions_report_version_number_unique unique ("reportId", "versionNumber")
);

comment on table ssbj_report_versions is
  'SSBJ 開示レポートの固定版（不変のスナップショット）。作成後は書き換えない。プレビュー・履歴・CSV は必ずここから読み、'
  'OGT の最新値を再取得しない（docs/ssbj-spec.md §8）。行の作成は create_ssbj_report_version（service_role 限定）でのみ行う。';
comment on column ssbj_report_versions."sourceVersionId" is
  '過去版から新版を作った場合（T11 の復元）の元の版。旧版自体は書き換えず、新しい版として作る。';

create index ssbj_report_versions_report_id_idx
  on ssbj_report_versions ("reportId", "versionNumber" desc);

-- §4 不変性: UPDATE はトリガーで全ロール拒否する（service_role も含む。§8）。
-- RLS の on/off に関わらずトリガーは発火するため、service_role による直接 UPDATE も止まる。

create function reject_ssbj_report_version_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ssbj_report_versions は書き換えできません（不変のスナップショット）' using errcode = 'P2033';
end;
$$;

create trigger reject_ssbj_report_versions_update
before update on ssbj_report_versions
for each row execute function reject_ssbj_report_version_update();

-- §5 RLS（select のみ。insert/update/delete は authenticated に許可しない。書き込みは create_ssbj_report_version 経由）

alter table ssbj_report_versions enable row level security;

create policy "ssbj_report_versions_select_own_organization"
on ssbj_report_versions
for select
to authenticated
using ("organizationId" = (select current_user_organization_id()));

grant select on ssbj_report_versions to authenticated;
-- insert/update/delete は GRANT しない（20260831000001_rls.sql §4.1 の default privileges により拒否される）。
-- service_role へは同ファイル §4.4 の default privileges で自動付与される。

-- §6 版生成 RPC（service_role 限定。単一トランザクションで採番・スナップショット生成・insert を行う）
--
-- service_role で RLS を越えるため、レポートの組織帰属（p_organization_id）はここで突き合わせる。
-- 呼び出し元（Route Handler）は getCurrentProfile() でログインユーザーの組織・ID をサーバ側から取得し、
-- クライアントからの値を信用しない（他組織のレポートに対して版を作れてしまうため）。
create function create_ssbj_report_version(
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
    'createdAt', v_report."createdAt",
    'updatedAt', v_report."updatedAt",
    'fiscalYearLabel', v_fiscal_year_label,
    'periodStart', v_period_start,
    'periodEnd', v_period_end
  );

  -- 各機能の ssbj_snapshot_section__<key> 関数を名前順に集める（§10）。T06 時点では 0 件でもよい。
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

comment on function create_ssbj_report_version(uuid, uuid, uuid, integer, text, uuid) is
  '保存版（固定スナップショット）の生成。採番・スナップショット生成・insert を1トランザクションで行う（部分保存の防止・§8）。'
  'レポート行をロックして draftRevision の一致を見る（不一致は競合として P2033 で中止）。'
  'p_source_version_id を渡すと過去版からの新版作成（T11 の復元）を表す（旧版は書き換えない）。'
  'service_role 限定。呼び出し元は getCurrentProfile() で組織・ユーザーを検証してから呼ぶこと。';

revoke execute on function create_ssbj_report_version(uuid, uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function create_ssbj_report_version(uuid, uuid, uuid, integer, text, uuid) to service_role;
