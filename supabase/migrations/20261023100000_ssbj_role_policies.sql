-- SSBJ 開示レポート（R2）: SSBJ のロールを、SSBJ の各テーブル・状態の変更・閲覧に適用する
-- （docs/authorization-matrix.md §2.1・§2.3・§3）。
--
-- 今の SSBJ は、同じ組織の利用者なら誰でもすべてを編集でき、権限で絞っていたのは承認・差戻しだけだった。
-- ここでは、20261010110000_ssbj_member_roles.sql の判定の関数で、入力・承認・閲覧を分ける:
--   - 作業中データの書き込み（レポートの作成・基本情報・文章・判断・リスク・機会・時間軸・根拠文書・採用の取り消し）は
--     入力担当か管理者だけ（承認担当・閲覧者は書けない）
--   - 閲覧者は、承認済みのレポートだけを見る（作業中データ・保存版の行・操作履歴は見えない）。保存版は内部メモ・内部記録を
--     含むため、承認した版の開示する内容だけを Route Handler（/api/ssbj/reports/[reportId]/approved-version）が除いて返す
--   - 状態の変更は、レビュー依頼・取り下げが入力担当か管理者、承認・差戻しが管理者か指定された承認者（承認担当）。
--     承認者に指定できるのは承認担当か管理者だけ
--
-- 既存のポリシー（自組織であること）は変えず、AS RESTRICTIVE のポリシーを足してロールの条件を重ねる。
-- 各機能のポリシーを書き換えないので、ほかの変更と食い違いにくい。SSBJ のテーブルを足すときも同じ形で足す。
-- OGT 本体のテーブル・関数・権限の仕組みは変えない。

-- §1 作業中データの書き込みは、入力担当か管理者だけ

create policy "ssbj_reports_insert_requires_ssbj_editor" on ssbj_reports
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_reports_update_requires_ssbj_editor" on ssbj_reports
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));

create policy "ssbj_risks_opportunities_insert_requires_ssbj_editor" on ssbj_risks_opportunities
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_risks_opportunities_update_requires_ssbj_editor" on ssbj_risks_opportunities
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_risks_opportunities_delete_requires_ssbj_editor" on ssbj_risks_opportunities
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));

create policy "ssbj_report_time_horizons_insert_requires_ssbj_editor" on ssbj_report_time_horizons
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_report_time_horizons_update_requires_ssbj_editor" on ssbj_report_time_horizons
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_report_time_horizons_delete_requires_ssbj_editor" on ssbj_report_time_horizons
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));

create policy "ssbj_evidence_insert_requires_ssbj_editor" on ssbj_evidence
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_evidence_update_requires_ssbj_editor" on ssbj_evidence
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_evidence_delete_requires_ssbj_editor" on ssbj_evidence
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));

create policy "ssbj_narratives_insert_requires_ssbj_editor" on ssbj_narratives
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_narratives_update_requires_ssbj_editor" on ssbj_narratives
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_narratives_delete_requires_ssbj_editor" on ssbj_narratives
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));

create policy "ssbj_judgements_insert_requires_ssbj_editor" on ssbj_judgements
as restrictive for insert to authenticated with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_judgements_update_requires_ssbj_editor" on ssbj_judgements
as restrictive for update to authenticated using ((select ssbj_current_user_can_edit())) with check ((select ssbj_current_user_can_edit()));
create policy "ssbj_judgements_delete_requires_ssbj_editor" on ssbj_judgements
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));

-- OGT の値の採用は service_role の RPC（Route Handler でロールを確かめる）。利用者が直接できるのは取り消し（delete）だけ。
create policy "ssbj_ogt_adoptions_delete_requires_ssbj_editor" on ssbj_ogt_adoptions
as restrictive for delete to authenticated using ((select ssbj_current_user_can_edit()));

-- §2 閲覧者は、承認済みのレポートだけを見る

create policy "ssbj_reports_select_viewer_approved_only" on ssbj_reports
as restrictive for select to authenticated
using ((select ssbj_current_user_can_view_working()) or status = 'approved');

-- 保存版の snapshot は内部メモ・内部記録（docs/ssbj-spec.md §5）を含む。列や行の一部だけを RLS で隠せないため、
-- 閲覧者には承認した版も含めて 1 行も見せない。閲覧者は、承認した版の開示する内容だけを Route Handler から受け取る。
create policy "ssbj_report_versions_select_requires_working_access" on ssbj_report_versions
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));

create policy "ssbj_risks_opportunities_select_requires_working_access" on ssbj_risks_opportunities
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));
create policy "ssbj_report_time_horizons_select_requires_working_access" on ssbj_report_time_horizons
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));
create policy "ssbj_evidence_select_requires_working_access" on ssbj_evidence
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));
create policy "ssbj_narratives_select_requires_working_access" on ssbj_narratives
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));
create policy "ssbj_judgements_select_requires_working_access" on ssbj_judgements
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));
create policy "ssbj_ogt_adoptions_select_requires_working_access" on ssbj_ogt_adoptions
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));
create policy "ssbj_audit_logs_select_requires_working_access" on ssbj_audit_logs
as restrictive for select to authenticated using ((select ssbj_current_user_can_view_working()));

-- §3 出力の記録: 閲覧者が記録できる（= 出力できる）のは、承認した保存版の CSV / Excel だけ
-- 20261002090000_ssbj_audit_logs.sql の関数を置き換える（引数・権限・戻り値は同じ）。閲覧者が出力する承認した版の行は
-- 閲覧者の RLS では見えないが、この関数は security definer なので版を確かめられる。未承認の版・操作履歴の出力の記録は、
-- 版が見つからないものとして拒否する（P2031）。

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

  -- 閲覧者は、承認済みのレポートの承認した保存版の CSV / Excel だけ（作業中・未承認の版・操作履歴は見えないため）。
  if not public.ssbj_current_user_can_view_working() and (
    p_format not in ('csv', 'xlsx')
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
  'SSBJ のファイル出力（CSV / Excel / 操作履歴の出力）を操作履歴に記録する。自組織のレポートだけ。閲覧者は承認した版の CSV / Excel だけ。'
  'P2031 = レポート・版が無い（見えない）、P2061 = 形式が不正。';

revoke execute on function record_ssbj_export(uuid, text, uuid) from public, anon;
grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;

-- §4 状態の変更（20261010100000_ssbj_self_approval_guard.sql の関数を置き換える。引数・権限・戻り値の形は同じで、
-- 権限の判定を SSBJ のロールにした）
-- エラー: P2031 = レポートが無い・組織不一致・操作者が組織に属さない / P2033 = draftRevision の競合 /
--         P2052 = 承認者の指定が不正（同じ組織の承認担当か管理者でない） / P2053 = その操作の権限が無い /
--         P2054 = その状態からはできない操作 / P2056 = 自己承認 / P2057 = 差戻しの理由が無い

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
  -- コメントは前後の空白（改行・タブ・全角スペース・NBSP・BOM を含む）を除き、空なら無いものとする（20261010100000 と同じ式）。
  -- btrim() は半角スペースしか除かないため使わない（改行・タブだけの差戻しの理由を通してしまう）。
  v_comment text := nullif(regexp_replace(coalesce(p_comment, ''), '^[\s\u00a0\u3000\ufeff]+|[\s\u00a0\u3000\ufeff]+$', '', 'g'), '');
begin
  select * into v_report from ssbj_reports where id = p_report_id for update;
  if not found or v_report."organizationId" <> p_organization_id then
    raise exception 'レポートが見つからないか、組織に属していません: %', p_report_id using errcode = 'P2031';
  end if;

  -- SSBJ のロール（admin / editor / approver / viewer）。組織の利用者でなければ null。
  v_actor_role := ssbj_user_role(p_actor_user_id, p_organization_id);
  if v_actor_role is null then
    raise exception '操作者が組織に属していません' using errcode = 'P2031';
  end if;
  -- 承認・差戻しは、管理者か、指定された承認者でロールが承認担当の人。
  v_is_privileged := v_actor_role = 'admin'
    or (v_actor_role = 'approver' and p_actor_user_id = v_report."approverUserId");

  if v_report."draftRevision" <> p_expected_draft_revision then
    raise exception '他の変更と競合しました。画面を開き直してください（現在の draftRevision % ≠ 画面が保持していた %）',
      v_report."draftRevision", p_expected_draft_revision
      using errcode = 'P2033';
  end if;

  v_approver := v_report."approverUserId";
  v_requester := v_report."reviewRequestedByUserId";

  if p_action in ('submit', 'withdraw') and v_actor_role not in ('admin', 'editor') then
    raise exception 'レビューの依頼・取り下げは、入力担当か管理者だけができます' using errcode = 'P2053';
  end if;

  if p_action = 'submit' then
    if v_report.status <> 'draft' then
      raise exception '作成中のレポートだけレビューを依頼できます' using errcode = 'P2054';
    end if;
    if p_approver_user_id is null or not ssbj_user_can_approve(p_approver_user_id, p_organization_id) then
      raise exception '承認者には、同じ組織の承認担当か管理者を指定してください' using errcode = 'P2052';
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
      raise exception '承認できるのは、指定された承認者（承認担当）か管理者だけです' using errcode = 'P2053';
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
      raise exception '差戻しができるのは、指定された承認者（承認担当）か管理者だけです' using errcode = 'P2053';
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
  'SSBJ レポートの状態を変える（submit / withdraw / approve / reopen）。service_role 限定。権限は SSBJ のロールで判定する。'
  'P2031 = 不在・組織不一致 / P2033 = 競合 / P2052 = 承認者が不正 / P2053 = 権限なし / P2054 = 状態の遷移が不正 / '
  'P2056 = 自己承認 / P2057 = 差戻しの理由が無い。';

revoke execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;
grant execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) to service_role;
