-- SSBJ 開示レポート（試行版 R1）: 基本情報の編集競合の検知（docs/ssbj-spec.md §8「作業中データの編集の競合」）。
--
-- 基本情報の更新はレポートの ID だけを条件にしていたため、古い画面から保存すると、先に保存された他の画面の変更を
-- 黙って上書きしていた。画面は読込時の版数を持ち、更新の条件に含める（一致しなければ 0 件更新 = 競合）。
--
-- draftRevision と updatedAt は条件に使えない。どちらもレポート全体の変更（文章・判断・リスク・機会などの各機能の変更に伴う
-- draftRevision の繰り上げ、状態の変更）で進むため、基本情報と関係の無い編集まで競合になる。
-- そこで、基本情報の列が変わったときだけ進む版数 "basicInfoRevision" を足す。
-- 各機能のテーブルの行は、その行の "updatedAt" を条件にする（行ごとに変わり、他の行の変更では変わらない）ので、列は足さない。

-- §1 列

alter table ssbj_reports
  add column "basicInfoRevision" integer not null default 0;

comment on column ssbj_reports."basicInfoRevision" is
  '基本情報の版数。基本情報の列が変わったときだけ +1 する（bump_ssbj_reports_own_draft_revision）。'
  '画面は読込時の値を更新の条件に含め、0 件更新なら他の画面の変更との競合として保存を拒否する（docs/ssbj-spec.md §8）。'
  'authenticated の更新の列 GRANT には含めない（クライアントは条件に使うだけで、書けない）。';

-- §2 基本情報の変更で basicInfoRevision も進める
-- （対象の列は draftRevision と同じ。関数名・引数は変えない。create or replace は既存のトリガーと権限を保つ）。
-- BEFORE UPDATE で NEW を書き換えるため、列 GRANT に basicInfoRevision が無くても書ける（draftRevision と同じ）。

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
    new."basicInfoRevision" := old."basicInfoRevision" + 1;
  end if;
  return new;
end;
$$;

-- §3 操作履歴で basicInfoRevision を内容の変更として記録しない
-- （本体は 20261002090000_ssbj_audit_logs.sql と同じで、v_ignored に basicInfoRevision を足しただけ）。
-- 引数: tg_argv[0] = 対象の種類、tg_argv[1] = 対象の識別子の列、tg_argv[2]（任意）= 画面に出す名前の列。
-- security definer: 記録先は利用者が書けないテーブルのため。記録するのは、呼び出し元テーブルの RLS を通った行だけ。

create or replace function ssbj_audit_row_change()
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
    'updatedAt', 'updatedByUserId', 'draftRevision', 'basicInfoRevision', 'status', 'approverUserId', 'approvedAt',
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
