// SSBJ レポートの自己承認の禁止と差戻しの理由の必須化（supabase/migrations/*_ssbj_self_approval_guard.sql）に対する
// 回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 動作（拒否・通過の結果）はローカル DB で確かめ、ここでは取り違えると穴になる文面を固定する。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_WORKFLOW_SQLSTATE } from '@/features/ssbj/services/reportWorkflowServer';
import { SSBJ_APPROVAL_BLOCKERS } from '@/features/ssbj/types';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const migration = (suffix: string): string => {
  const name = readdirSync(migrationsDir).find(file => file.endsWith(suffix));
  if (!name) throw new Error(`${suffix} のマイグレーションが見つかりません`);
  return readFileSync(path.join(migrationsDir, name), 'utf8')
    .split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
};
const guard = migration('_ssbj_self_approval_guard.sql');

// 状態の変更の関数のうち、指定した操作の分岐（elsif / else まで）。
const branch = (action: string): string => {
  const start = guard.indexOf(`p_action = '${action}' then`);
  expect(start).toBeGreaterThan(0);
  const end = guard.slice(start).search(/ elsif p_action = | else raise exception '状態の操作が不正です/);
  return guard.slice(start, start + end);
};

describe('自己承認の禁止', () => {
  it('SQLSTATE は reportWorkflowServer.ts と同じ', () => {
    expect(SSBJ_WORKFLOW_SQLSTATE.selfApproval).toBe('P2056');
    expect(SSBJ_WORKFLOW_SQLSTATE.reopenReasonRequired).toBe('P2057');
    expect(guard).toContain("errcode = 'P2056'");
    expect(guard).toContain("errcode = 'P2057'");
  });

  it('承認できない理由の値は types.ts と同じ', () => {
    for (const blocker of SSBJ_APPROVAL_BLOCKERS) {
      expect(guard).toContain(`return '${blocker}';`);
    }
  });

  it('レビュー依頼: 承認者に依頼者自身を指定できず、依頼者を記録する', () => {
    const submit = branch('submit');
    expect(submit).toContain("if p_approver_user_id = p_actor_user_id then raise exception '自分を承認者に指定することはできません");
    expect(submit).toContain('v_requester := p_actor_user_id;');
    expect(guard).toContain('"reviewRequestedByUserId" = v_requester,');
  });

  it('承認: 権限の確認の後で、依頼した本人・依頼の後に変更した人を（管理者でも）拒否する', () => {
    const approve = branch('approve');
    const privilege = approve.indexOf('if not v_is_privileged then');
    const blocker = approve.indexOf('v_blocker := ssbj_approval_blocker(p_report_id, p_actor_user_id);');
    expect(privilege).toBeGreaterThan(0);
    expect(blocker).toBeGreaterThan(privilege);
    expect(approve).toContain("if v_blocker = 'requester' then raise exception 'レビューを依頼した本人は承認できません");
    expect(approve).toContain("elsif v_blocker = 'edited_after_request' then raise exception 'レビューの依頼の後に内容を変更した人は承認できません");
  });

  it('「依頼の後の変更」は最後のレビュー依頼より後の、その人の作成・更新・削除・復元で判定する（保存版の作成・出力は数えない）', () => {
    expect(guard).toContain("and l.action = 'status_change' and l.details ->> 'operation' = 'submit' order by l.id desc limit 1;");
    expect(guard).toContain('and l.id > v_submit_log_id and l."actorUserId" = p_user_id');
    expect(guard).toContain("and l.action in ('create', 'update', 'delete', 'version_restore')");
    // 列を足す前に依頼されたレポートは、最後のレビュー依頼の操作者を依頼者とみなす。
    expect(guard).toContain('select coalesce(r."reviewRequestedByUserId", v_submit_actor) into v_requester');
  });

  it('差戻しは理由が必須（空白だけも不可）', () => {
    expect(guard).toContain("v_comment text := nullif(btrim(coalesce(p_comment, '')), '');");
    expect(branch('reopen')).toContain("if v_comment is null then raise exception '差戻しの理由を入力してください' using errcode = 'P2057';");
  });

  it('依頼者の列の更新は行ごとの操作履歴に出さない（依頼のたびに基本情報の更新が並ばない）', () => {
    const on = guard.indexOf("perform set_config('ssbj.suppress_audit', 'on', true); update ssbj_reports set status = v_next_status");
    const off = guard.indexOf("perform set_config('ssbj.suppress_audit', '', true);");
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(on);
  });
});

describe('権限', () => {
  it('状態の変更は引き続き service_role 限定（引数は同じ）', () => {
    expect(guard).toContain('create or replace function change_ssbj_report_status( p_report_id uuid, p_organization_id uuid, p_actor_user_id uuid, p_action text, p_expected_draft_revision integer, p_approver_user_id uuid default null, p_comment text default null )');
    expect(guard).toContain('revoke execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;');
    expect(guard).toContain('grant execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) to service_role;');
  });

  it('利用者を指定する判定関数は service_role 限定。画面用はログイン中の利用者・自組織のレポートだけ', () => {
    expect(guard).toContain('revoke execute on function ssbj_approval_blocker(uuid, uuid) from public, anon, authenticated;');
    expect(guard).toContain('grant execute on function ssbj_approval_blocker(uuid, uuid) to service_role;');
    expect(guard).toContain('r."organizationId" = current_user_organization_id()');
    expect(guard).toContain('return ssbj_approval_blocker(p_report_id, auth.uid());');
    expect(guard).toContain('revoke execute on function ssbj_my_approval_blocker(uuid) from public, anon;');
    expect(guard).toContain('grant execute on function ssbj_my_approval_blocker(uuid) to authenticated;');
  });

  it('OGT 本体の権限の仕組みは変えない（本体の関数・profiles を書き換えない）', () => {
    expect(guard).not.toMatch(/function (public\.)?current_user_(can_edit|is_admin)/);
    expect(guard).not.toMatch(/alter table (public\.)?profiles/);
  });
});
