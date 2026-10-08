-- SSBJ 開示レポート（試行版 R1）: 承認と保存の排他（docs/ssbj-spec.md §13「状態管理と承認ロック」）。
--
-- 承認済みの間の変更の拒否（reject_ssbj_change_when_approved。20261002090100_ssbj_report_status.sql）は、レポートの状態を
-- ロックせずに読んでいた。承認の処理がレポートの行をロックしている間に保存が始まると、保存側は承認前の「レビュー中」を読んで通り、
-- 版数の繰り上げ（bump_ssbj_draft_revision）でロックの解除を待った後、状態を読み直さずに書き込みを確定していた。
-- その結果、状態は承認済みなのに、作業中の内容が承認した版と食い違うことがあった。
--
-- ここでは、作業中データへの書き込みが、レポートの行をロックしてから状態を読むように変える。承認・差戻し・保存版の作成・復元も
-- レポートの行をロックするので、同じレポートの承認と保存は DB で 1 つずつ処理される:
--   - 承認が先に確定したとき: 保存は承認の確定を待ち、確定後の状態（承認済み）を読んで P2051 で拒否される
--   - 保存が先に確定したとき: 承認は保存の確定を待ち、確定後の draftRevision が画面の値と違うので P2033（競合）で拒否される
-- 基本情報（ssbj_reports 自身）の更新は、もとから行のロックを取ってから BEFORE トリガーが最新の状態を読むので、変えない。
--
-- ロックを取る順番（デッドロックを避けるため、すべての書き込みでそろえる）: 作業中データの行 → レポートの行。
--   - 利用者の更新・削除: 対象の行（UPDATE / DELETE が取る）→ レポートの行（reject_ssbj_change_when_approved）
--   - 利用者の追加: レポートの行（reject_ssbj_change_when_approved）→ 追加した行
--   - 作業中データの行を書き換える RPC（版の復元・OGT の値の採用）: lock_ssbj_report_working_rows で、作業中データの行を
--     先にまとめてロックしてから、レポートの行をロックする
--   - 状態の変更・保存版の作成: レポートの行だけ（作業中データは読むだけで、ロックしない）

-- §1 承認済みの間の変更の拒否（レポートの行をロックしてから状態を読む）

-- for no key update は、版数の繰り上げ（bump_ssbj_draft_revision）が同じ行を update するときと同じ強さのロック。
-- これより弱いロック（for share）を先に取ると、同じレポートを同時に保存した 2 人が、互いのロックの解除を待ってデッドロックになる。
-- read committed では、ロックの解除を待った後は確定後の行を読むので、承認が先に確定していれば承認済みが見える。
create or replace function reject_ssbj_change_when_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_report_id := old."reportId";
  else
    v_report_id := new."reportId";
  end if;

  select r.status into v_status from public.ssbj_reports r where r.id = v_report_id for no key update;
  if v_status = 'approved' then
    raise exception '承認済みのレポートは変更できません。変更するには、管理者か承認者が差戻してください'
      using errcode = 'P2051';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function reject_ssbj_change_when_approved() is
  'SSBJ の作業中データのテーブルに付ける BEFORE トリガー。レポートの行をロックしてから状態を読み、承認済みなら変更を拒否する（P2051）。'
  '承認の処理と重なったときは、承認の確定を待ってから判定する。';

-- §2 作業中データの行とレポートの行をまとめてロックする（作業中データの行を書き換える RPC が最初に呼ぶ）

-- 対象は、承認ロックのトリガー（reject_ssbj_change_when_approved）を付けたテーブル。各機能が §10 の手順でトリガーを付ければ、
-- ここに書き足さなくても対象になる。テーブルは名前順、行は主キー順にロックする（同じ関数を呼ぶ処理同士でも順番がそろう）。
-- 最後にレポートの行を for update でロックする（承認・差戻し・保存版の作成と同じ強さ）。
create function lock_ssbj_report_working_rows(p_report_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_table record;
begin
  for v_table in
    select c.relname, (
      select string_agg(quote_ident(a.attname), ', ' order by k.ordinality)
      from unnest(i.indkey::int2[]) with ordinality as k(attnum, ordinality)
      join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
    ) as primary_key
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_index i on i.indrelid = c.oid and i.indisprimary
    where n.nspname = 'public'
      and t.tgfoid = 'public.reject_ssbj_change_when_approved()'::regprocedure
      and not t.tgisinternal
    order by c.relname
  loop
    execute format(
      'select count(*) from (select 1 from public.%I where "reportId" = $1 order by %s for update) as locked_rows',
      v_table.relname, v_table.primary_key
    ) using p_report_id;
  end loop;

  perform 1 from ssbj_reports where id = p_report_id for update;
end;
$$;

comment on function lock_ssbj_report_working_rows(uuid) is
  '作業中データの行（承認ロックのトリガーを付けたテーブル）を名前順・主キー順にロックしてから、レポートの行をロックする。'
  '作業中データの行を書き換える RPC が最初に呼ぶ（利用者の保存と同じ「作業中データの行 → レポートの行」の順にそろえ、デッドロックを避ける）。service_role 限定。';

revoke execute on function lock_ssbj_report_working_rows(uuid) from public, anon, authenticated;
grant execute on function lock_ssbj_report_working_rows(uuid) to service_role;

-- §3 版の復元: 作業中データの行を先にロックする（20261002090200_ssbj_restore_version.sql の定義に、最初のロックを足しただけ）

-- これまではレポートの行を先にロックしてから作業中データの行を消していたため、利用者の更新・削除（作業中データの行 → レポートの行）と
-- 重なると、互いのロックを待ってデッドロックになることがあった。
create or replace function restore_ssbj_report_version(
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
  perform lock_ssbj_report_working_rows(p_report_id);

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

-- §4 OGT の値の採用: 作業中データの行を先にロックする（20260929180243_ssbj_ogt_adoptions.sql の定義に、ロックを足しただけ）

-- 採用は insert … on conflict do update で、追加のトリガーがレポートの行をロックした後に既存の採用の行をロックする。
-- 利用者の採用の取り消し（既存の採用の行 → レポートの行）と逆の順番になるため、先に lock_ssbj_report_working_rows でそろえる。
create or replace function adopt_ssbj_ogt_values(
  p_report_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_candidates jsonb,
  p_supplier_references jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_fiscal_year_id uuid;
  v_adopted_at timestamptz := now();
  v_adopted_values jsonb;
begin
  select "fiscalYearId" into v_fiscal_year_id
  from ssbj_reports
  where id = p_report_id
    and "organizationId" = p_organization_id;

  if not found then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id
      using errcode = 'P2041';
  end if;

  perform lock_ssbj_report_working_rows(p_report_id);

  if jsonb_typeof(p_candidates) <> 'array' or jsonb_array_length(p_candidates) = 0
     or jsonb_typeof(p_supplier_references) <> 'array' then
    raise exception '採用する候補値の形式が正しくありません'
      using errcode = 'P2042';
  end if;

  -- 候補値・参考値がすべてレポートの年度のものであること（別の年度の値を採用させない）。
  if exists (
    select 1 from jsonb_array_elements(p_candidates || p_supplier_references) as item(value)
    where item.value ->> 'fiscalYearId' is distinct from v_fiscal_year_id::text
  ) then
    raise exception '候補値の年度がレポートの年度と一致しません'
      using errcode = 'P2042';
  end if;

  select jsonb_agg(
    item.value || jsonb_build_object('adoptedAt', v_adopted_at, 'adoptedBy', p_actor_user_id)
    order by item.ordinality
  )
  into v_adopted_values
  from jsonb_array_elements(p_candidates) with ordinality as item(value, ordinality);

  insert into ssbj_ogt_adoptions
    ("organizationId", "reportId", "adoptedValues", "supplierReferences", "adoptedAt", "adoptedByUserId")
  values
    (p_organization_id, p_report_id, v_adopted_values, p_supplier_references, v_adopted_at, p_actor_user_id)
  on conflict ("reportId") do update set
    "adoptedValues" = excluded."adoptedValues",
    "supplierReferences" = excluded."supplierReferences",
    "adoptedAt" = excluded."adoptedAt",
    "adoptedByUserId" = excluded."adoptedByUserId";

  return jsonb_build_object('adoptedAt', v_adopted_at);
end;
$$;
