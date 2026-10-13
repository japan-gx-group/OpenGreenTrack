-- SSBJ 開示レポート（R2）: 自己承認の禁止と、差戻しの理由の必須化（docs/ssbj-spec.md §13「状態管理と承認ロック」）。
--
-- 20261002090100_ssbj_report_status.sql の承認ロックは、1 人で回せてしまっていた:
--   - レビュー依頼のときに承認者として自分を指定し、そのまま承認できる
--   - 承認者がレビュー中に本文を直し、そのまま承認できる
-- 書く人と承認する人を分けないと、承認の記録が意味を持たない。ここでは状態の変更（change_ssbj_report_status）で次を拒否する
-- （どれも P2056。管理者でも拒否する）:
--   1. レビュー依頼で、承認者に依頼者自身を指定する
--   2. レビューを依頼した本人が承認する
--   3. レビュー依頼の後に作業中データを変更した利用者が承認する（操作履歴 ssbj_audit_logs で判定する）
-- あわせて、差戻し（reopen）では理由のコメントを必須にする（P2057）。何を直すべきかを記録に残すため。
--
-- OGT 本体の権限の仕組みは変えない（profiles.role を読むだけ）。

-- §1 レビューを依頼した利用者

alter table ssbj_reports
  add column "reviewRequestedByUserId" uuid;

comment on column ssbj_reports."reviewRequestedByUserId" is
  'レビューを依頼した利用者（profiles.id）。change_ssbj_report_status の submit だけが書く。依頼した本人は承認できない。';

-- §2 承認できない理由（自己承認の判定）
-- 戻り値: 'requester'（レビューを依頼した本人）/ 'edited_after_request'（依頼の後に作業中データを変更した）/ null（承認してよい）。
-- 依頼者は列で持つ。この列を足す前に依頼されたレポート（列が空）は、操作履歴の最後のレビュー依頼の操作者を依頼者とみなす。
-- 「依頼の後の変更」は、最後のレビュー依頼の記録より後にある、その利用者の作成・更新・削除・復元の記録で判定する
-- （操作履歴の id は記録順に増える。保存版の作成・ファイルの出力は内容を変えないので数えない）。
-- 権限（指定された承認者か管理者か）は呼び出し元が判定する。ここは自己承認だけを見る。

create function ssbj_approval_blocker(p_report_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v_submit_log_id bigint;
  v_submit_actor uuid;
  v_requester uuid;
begin
  select l.id, l."actorUserId" into v_submit_log_id, v_submit_actor
  from ssbj_audit_logs l
  where l."reportId" = p_report_id
    and l.action = 'status_change'
    and l.details ->> 'operation' = 'submit'
  order by l.id desc
  limit 1;

  select coalesce(r."reviewRequestedByUserId", v_submit_actor) into v_requester
  from ssbj_reports r
  where r.id = p_report_id;

  if v_requester is not null and v_requester = p_user_id then
    return 'requester';
  end if;

  if v_submit_log_id is not null and exists (
    select 1
    from ssbj_audit_logs l
    where l."reportId" = p_report_id
      and l.id > v_submit_log_id
      and l."actorUserId" = p_user_id
      and l.action in ('create', 'update', 'delete', 'version_restore')
  ) then
    return 'edited_after_request';
  end if;

  return null;
end;
$$;

comment on function ssbj_approval_blocker(uuid, uuid) is
  'SSBJ レポートを、その利用者が承認できない理由（requester / edited_after_request）。承認してよければ null。'
  'change_ssbj_report_status と ssbj_my_approval_blocker が使う。service_role 限定。';

revoke execute on function ssbj_approval_blocker(uuid, uuid) from public, anon, authenticated;
grant execute on function ssbj_approval_blocker(uuid, uuid) to service_role;

-- 画面の案内用: ログイン中の利用者が承認できない理由（承認ボタンを押す前に理由を出すため）。正本の判定は状態の変更が行う。
create function ssbj_my_approval_blocker(p_report_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from ssbj_reports r
    where r.id = p_report_id and r."organizationId" = current_user_organization_id()
  ) then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;
  return ssbj_approval_blocker(p_report_id, auth.uid());
end;
$$;

comment on function ssbj_my_approval_blocker(uuid) is
  'ログイン中の利用者が、自組織の SSBJ レポートを承認できない理由（requester / edited_after_request / null）。画面の案内用。P2031 = レポートが無い。';

revoke execute on function ssbj_my_approval_blocker(uuid) from public, anon;
grant execute on function ssbj_my_approval_blocker(uuid) to authenticated;

-- §3 状態の変更（20261002090100_ssbj_report_status.sql の関数を置き換える。引数・権限・戻り値の形は同じで、
-- 自己承認の拒否・差戻しの理由の必須化・依頼者の記録を足した）
-- エラー: P2031 = レポートが無い・組織不一致・操作者が組織に属さない / P2033 = draftRevision の競合 /
--         P2052 = 承認者の指定が不正 / P2053 = その操作の権限が無い / P2054 = その状態からはできない操作 /
--         P2056 = 自己承認（承認者に自分を指定・依頼した本人の承認・依頼の後に変更した人の承認）/ P2057 = 差戻しの理由が無い

create or replace function change_ssbj_report_status(
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
  v_requester uuid;
  v_blocker text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
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
  v_requester := v_report."reviewRequestedByUserId";

  if p_action = 'submit' then
    if v_report.status <> 'draft' then
      raise exception '作成中のレポートだけレビューを依頼できます' using errcode = 'P2054';
    end if;
    if p_approver_user_id is null
       or not exists (select 1 from profiles where id = p_approver_user_id and "organizationId" = p_organization_id) then
      raise exception '承認者には同じ組織の利用者を指定してください' using errcode = 'P2052';
    end if;
    if p_approver_user_id = p_actor_user_id then
      raise exception '自分を承認者に指定することはできません。ほかの利用者を選んでください' using errcode = 'P2056';
    end if;
    v_next_status := 'in_review';
    v_approver := p_approver_user_id;
    v_requester := p_actor_user_id;
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
    -- 管理者でも、自分が依頼した・依頼の後に変更したレポートは承認できない（書く人と承認する人を分ける）。
    v_blocker := ssbj_approval_blocker(p_report_id, p_actor_user_id);
    if v_blocker = 'requester' then
      raise exception 'レビューを依頼した本人は承認できません。ほかの承認者か管理者が承認してください' using errcode = 'P2056';
    elsif v_blocker = 'edited_after_request' then
      raise exception 'レビューの依頼の後に内容を変更した人は承認できません。ほかの承認者か管理者が承認してください'
        using errcode = 'P2056';
    end if;
    v_next_status := 'approved';
  elsif p_action = 'reopen' then
    if v_report.status not in ('in_review', 'approved') then
      raise exception 'レビュー中・承認済みのレポートだけ差戻せます' using errcode = 'P2054';
    end if;
    if not v_is_privileged then
      raise exception '差戻しができるのは、指定された承認者か管理者だけです' using errcode = 'P2053';
    end if;
    if v_comment is null then
      raise exception '差戻しの理由を入力してください' using errcode = 'P2057';
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

  -- 状態の列の変更は、下で 1 件だけ記録する。依頼者の列は行ごとの操作履歴が無視する列に入っていないので、
  -- この更新の間だけ行ごとの記録を止める（依頼のたびに「基本情報の更新」が履歴に並ばないように）。
  -- 承認者と依頼者は、取り下げ・差戻しの後も残す（承認者は次のレビュー依頼の既定にするため）。
  perform set_config('ssbj.suppress_audit', 'on', true);
  update ssbj_reports
  set status = v_next_status,
      "approverUserId" = v_approver,
      "reviewRequestedByUserId" = v_requester,
      "approvedAt" = case when v_next_status = 'approved' then now() else null end,
      "approvedByUserId" = case when v_next_status = 'approved' then p_actor_user_id else null end,
      "approvedVersionId" = case when v_next_status = 'approved' then v_version_id else null end,
      "statusChangedAt" = now(),
      "statusChangedByUserId" = p_actor_user_id,
      "updatedByUserId" = p_actor_user_id
  where id = p_report_id;
  perform set_config('ssbj.suppress_audit', '', true);

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
       'comment', v_comment
     )));

  return jsonb_strip_nulls(jsonb_build_object(
    'status', v_next_status,
    'approverUserId', v_approver,
    'reviewRequestedByUserId', v_requester,
    'approvedVersionId', v_version_id,
    'approvedVersionNumber', (v_version ->> 'versionNumber')::integer
  ));
end;
$$;

comment on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) is
  'SSBJ レポートの状態を変える（submit / withdraw / approve / reopen）。service_role 限定。'
  'P2031 = 不在・組織不一致 / P2033 = 競合 / P2052 = 承認者が不正 / P2053 = 権限なし / P2054 = 状態の遷移が不正 / '
  'P2056 = 自己承認 / P2057 = 差戻しの理由が無い。';

revoke execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) to service_role;
