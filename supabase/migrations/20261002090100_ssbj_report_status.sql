-- SSBJ 開示レポート（試行版 R1）: 状態管理と承認ロック（docs/ssbj-spec.md §13「状態管理と承認ロック」）。
--
-- レポートの状態は 作成中（draft）→ レビュー中（in_review）→ 承認済み（approved）。承認済みの間は、作業中データ
-- （基本情報・文章・判断・リスク・機会・時間軸の定義・根拠文書・OGT の採用値）を DB で変更できなくする。
-- 状態の変更は change_ssbj_report_status（service_role 限定。Route Handler から呼ぶ）だけで行う。
--
-- 権限（OGT 本体の権限の仕組みは変えない。profiles.role を読むだけ）:
--   - レビュー依頼（承認者を指定）・依頼の取り下げ: 自組織の利用者なら誰でも
--   - 承認: 指定された承認者か、OGT の管理者（profiles.role = 'admin'）
--   - 差戻し（レビュー中・承認済み → 作成中。承認済みならロック解除）: 指定された承認者か、OGT の管理者
-- 承認するときは、その時点の内容で保存版を作り、承認した版として記録する（承認した内容をあとから再現できるように）。

-- §1 列

alter table ssbj_reports
  add column status varchar(20) not null default 'draft',
  add column "approverUserId" uuid,
  add column "approvedAt" timestamptz,
  add column "approvedByUserId" uuid,
  add column "approvedVersionId" uuid references ssbj_report_versions(id) on delete set null,
  add column "statusChangedAt" timestamptz,
  add column "statusChangedByUserId" uuid,
  add constraint ssbj_reports_status_check check (status in ('draft', 'in_review', 'approved')),
  add constraint ssbj_reports_approved_fields_check check (
    (status = 'approved' and "approvedAt" is not null and "approvedByUserId" is not null)
    or (status <> 'approved' and "approvedAt" is null and "approvedByUserId" is null and "approvedVersionId" is null)
  ),
  add constraint ssbj_reports_review_approver_check check (status = 'draft' or "approverUserId" is not null);

comment on column ssbj_reports.status is
  'draft（作成中）/ in_review（レビュー中）/ approved（承認済み。作業中データを変更できない）。change_ssbj_report_status だけが変える。';
comment on column ssbj_reports."approverUserId" is 'レビューを依頼された承認者（profiles.id）。承認と差戻しができる。';
comment on column ssbj_reports."approvedVersionId" is '承認したときに作った保存版。';

-- §2 承認済みの間の変更の拒否

-- 作業中データのテーブル（"reportId" 列を持つ）に BEFORE INSERT/UPDATE/DELETE で付ける。
-- レポートが無い（レポートの削除に伴う連鎖削除）ときは止めない。
create function reject_ssbj_change_when_approved()
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

  select r.status into v_status from public.ssbj_reports r where r.id = v_report_id;
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
  'SSBJ の作業中データのテーブルに付ける BEFORE トリガー。レポートが承認済みなら変更を拒否する（P2051）。';

create trigger reject_ssbj_risks_opportunities_when_approved
before insert or update or delete on ssbj_risks_opportunities
for each row execute function reject_ssbj_change_when_approved();

create trigger reject_ssbj_report_time_horizons_when_approved
before insert or update or delete on ssbj_report_time_horizons
for each row execute function reject_ssbj_change_when_approved();

create trigger reject_ssbj_evidence_when_approved
before insert or update or delete on ssbj_evidence
for each row execute function reject_ssbj_change_when_approved();

create trigger reject_ssbj_ogt_adoptions_when_approved
before insert or update or delete on ssbj_ogt_adoptions
for each row execute function reject_ssbj_change_when_approved();

create trigger reject_ssbj_narratives_when_approved
before insert or update or delete on ssbj_narratives
for each row execute function reject_ssbj_change_when_approved();

create trigger reject_ssbj_judgements_when_approved
before insert or update or delete on ssbj_judgements
for each row execute function reject_ssbj_change_when_approved();

-- ssbj_reports 自身: 承認済みの間は基本情報を変えられない（状態の列は change_ssbj_report_status が変える）。
create function reject_ssbj_report_basic_info_when_approved()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'approved' and (
    new.title is distinct from old.title
    or new.purpose is distinct from old.purpose
    or new."reportingScope" is distinct from old."reportingScope"
    or new."standardVersion" is distinct from old."standardVersion"
    or new."parentCompanyName" is distinct from old."parentCompanyName"
    or new."parentRelationship" is distinct from old."parentRelationship"
    or new."ownershipPercentage" is distinct from old."ownershipPercentage"
    or new."measurementApproach" is distinct from old."measurementApproach"
    or new."industryCode" is distinct from old."industryCode"
  ) then
    raise exception '承認済みのレポートは変更できません。変更するには、管理者か承認者が差戻してください'
      using errcode = 'P2051';
  end if;
  return new;
end;
$$;

-- 名前順で他の BEFORE UPDATE トリガー（bump / set_ssbj_reports_*）より先に走るよう、a_ で始める。
create trigger a_reject_ssbj_reports_basic_info_when_approved
before update on ssbj_reports
for each row execute function reject_ssbj_report_basic_info_when_approved();

-- §3 状態の変更（service_role 限定）
-- p_action: submit（作成中 → レビュー中。承認者の指定が必要）/ withdraw（レビュー中 → 作成中）/
--           approve（レビュー中 → 承認済み。画面が見ていた draftRevision と一致すること）/
--           reopen（レビュー中・承認済み → 作成中。差戻し）
-- エラー: P2031 = レポートが無い・組織不一致・操作者が組織に属さない / P2033 = draftRevision の競合 /
--         P2052 = 承認者の指定が不正 / P2053 = その操作の権限が無い / P2054 = その状態からはできない操作

create function change_ssbj_report_status(
  p_report_id uuid,
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_expected_draft_revision integer,
  p_approver_user_id uuid default null,
  p_comment text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report ssbj_reports%rowtype;
  v_actor_role text;
  v_is_privileged boolean;
  v_next_status text;
  v_version jsonb;
  v_version_id uuid;
  v_approver uuid;
begin
  select * into v_report from ssbj_reports where id = p_report_id for update;
  if not found or v_report."organizationId" <> p_organization_id then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;

  select role into v_actor_role from profiles where id = p_actor_user_id and "organizationId" = p_organization_id;
  if not found then
    raise exception '操作者が組織に属していません' using errcode = 'P2031';
  end if;
  v_is_privileged := v_actor_role = 'admin' or p_actor_user_id = v_report."approverUserId";

  if v_report."draftRevision" <> p_expected_draft_revision then
    raise exception '他の変更と競合しました。画面を開き直してください（現在の draftRevision % ≠ 画面が保持していた %）',
      v_report."draftRevision", p_expected_draft_revision
      using errcode = 'P2033';
  end if;

  v_approver := v_report."approverUserId";

  if p_action = 'submit' then
    if v_report.status <> 'draft' then
      raise exception '作成中のレポートだけレビューを依頼できます' using errcode = 'P2054';
    end if;
    if p_approver_user_id is null
       or not exists (select 1 from profiles where id = p_approver_user_id and "organizationId" = p_organization_id) then
      raise exception '承認者には同じ組織の利用者を指定してください' using errcode = 'P2052';
    end if;
    v_next_status := 'in_review';
    v_approver := p_approver_user_id;
  elsif p_action = 'withdraw' then
    if v_report.status <> 'in_review' then
      raise exception 'レビュー中のレポートだけ依頼を取り下げられます' using errcode = 'P2054';
    end if;
    v_next_status := 'draft';
  elsif p_action = 'approve' then
    if v_report.status <> 'in_review' then
      raise exception 'レビュー中のレポートだけ承認できます' using errcode = 'P2054';
    end if;
    if not v_is_privileged then
      raise exception '承認できるのは、指定された承認者か管理者だけです' using errcode = 'P2053';
    end if;
    v_next_status := 'approved';
  elsif p_action = 'reopen' then
    if v_report.status not in ('in_review', 'approved') then
      raise exception 'レビュー中・承認済みのレポートだけ差戻せます' using errcode = 'P2054';
    end if;
    if not v_is_privileged then
      raise exception '差戻しができるのは、指定された承認者か管理者だけです' using errcode = 'P2053';
    end if;
    v_next_status := 'draft';
  else
    raise exception '状態の操作が不正です: %', p_action using errcode = 'P2054';
  end if;

  -- service_role の処理の操作者を、操作履歴のトリガーに渡す。
  perform set_config('ssbj.actor_user_id', p_actor_user_id::text, true);

  if p_action = 'approve' then
    -- 承認した内容を保存版として残す（版の作成は操作履歴に version_create として記録される）。
    v_version := create_ssbj_report_version(
      p_report_id, p_organization_id, p_actor_user_id, p_expected_draft_revision, '承認時の保存版', null
    );
    v_version_id := (v_version ->> 'id')::uuid;
  end if;

  -- 状態の列の変更は行ごとの操作履歴に出ない（ssbj_audit_row_change が無視する列）。下で 1 件だけ記録する。
  -- 承認者は、取り下げ・差戻しの後も残す（次のレビュー依頼の既定にするため）。
  update ssbj_reports
  set status = v_next_status,
      "approverUserId" = v_approver,
      "approvedAt" = case when v_next_status = 'approved' then now() else null end,
      "approvedByUserId" = case when v_next_status = 'approved' then p_actor_user_id else null end,
      "approvedVersionId" = case when v_next_status = 'approved' then v_version_id else null end,
      "statusChangedAt" = now(),
      "statusChangedByUserId" = p_actor_user_id,
      "updatedByUserId" = p_actor_user_id
  where id = p_report_id;

  insert into ssbj_audit_logs
    ("organizationId", "reportId", "actorUserId", action, "targetType", "targetId", details)
  values
    (p_organization_id, p_report_id, p_actor_user_id, 'status_change', 'report', p_report_id::text,
     jsonb_strip_nulls(jsonb_build_object(
       'operation', p_action,
       'from', v_report.status,
       'to', v_next_status,
       'approverUserId', v_approver,
       'versionId', v_version_id,
       'versionNumber', (v_version ->> 'versionNumber')::integer,
       'comment', nullif(btrim(coalesce(p_comment, '')), '')
     )));

  return jsonb_strip_nulls(jsonb_build_object(
    'status', v_next_status,
    'approverUserId', v_approver,
    'approvedVersionId', v_version_id,
    'approvedVersionNumber', (v_version ->> 'versionNumber')::integer
  ));
end;
$$;

comment on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) is
  'SSBJ レポートの状態を変える（submit / withdraw / approve / reopen）。service_role 限定。'
  'P2031 = 不在・組織不一致 / P2033 = 競合 / P2052 = 承認者が不正 / P2053 = 権限なし / P2054 = 状態の遷移が不正。';

revoke execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) to service_role;
