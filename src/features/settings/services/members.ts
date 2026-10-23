'use server';

// メンバー管理（ロールの変更・メンバーの削除）の Server Action。
//
// なぜ service_role（admin client）を使うか:
//   - メンバー削除は auth.users の削除（profiles へ on delete cascade）まで必要で、
//     authenticated のクライアントにはその権限がない。
//   - profiles.role は authenticated が更新できる列に含めていない（列 GRANT）。ロールの変更は
//     service_role 限定の RPC（change_member_role）で行い、RPC の中でも操作する人が管理者かを確かめる。
//
// どちらも管理者だけに許す。呼び出し元は Cookie セッションからサーバ側で確認する（requireAdmin）。
// service_role は RLS を越えるため、「対象が自組織のメンバーか」の確認はここでしか担保できない。
// 組織の管理者が 0 人になる変更は、ここで先に断り、DB のトリガー（ensure_organization_keeps_admin）が最後に必ず止める。

import { createAdminClient } from '@/lib/supabase/admin';
import { ADMIN_ONLY_MESSAGE, requireAdmin } from '@/lib/authz';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import type { ActionResult } from '@/types/actionResult';
import type { MemberRole } from '@/types/role';
import {
  LAST_ADMIN_MESSAGE,
  planMemberChanges,
  type MemberChangesInput,
} from './memberChangePlan';

// change_member_role の SQLSTATE（supabase/migrations/20261024090000_member_roles.sql）。
const ROLE_CHANGE_ERROR_MESSAGES: Record<string, string> = {
  P2081: LAST_ADMIN_MESSAGE,
  P2082: ADMIN_ONLY_MESSAGE,
  P2083: '対象のメンバーが見つかりません',
};

// 途中で失敗したときは、どこまで反映したかを添える（画面側は一覧を取り直して整合させる）。
const withAppliedCount = (message: string, applied: number) =>
  applied > 0 ? `${message}（${applied} 件は反映済みです）` : message;

// メンバー一覧画面の「下書き→保存」でまとめて確定するため、変更を一括で受け取る。
export const saveMemberChanges = async (
  input: MemberChangesInput,
): Promise<ActionResult> => {
  const check = await requireAdmin();
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const caller = check.profile;

  const hasRemovals = (input?.removedMemberIds ?? []).length > 0;
  const hasRoleChanges = (input?.roleChanges ?? []).length > 0;
  if (!hasRemovals && !hasRoleChanges) {
    return { ok: true, data: undefined };
  }

  const admin = createAdminClient();

  const { data: rows, error: membersError } = await admin
    .from('profiles')
    .select('id, role')
    .eq('organizationId', caller.organizationId);
  if (membersError) {
    return { ok: false, error: 'メンバー情報の確認に失敗しました' };
  }
  const members = (rows ?? []).map((row) => ({
    id: row.id as string,
    role: row.role as MemberRole,
  }));

  const planned = planMemberChanges(members, input ?? { removedMemberIds: [] }, caller.id);
  if (!planned.ok) {
    return { ok: false, error: planned.error };
  }
  const { promotions, demotions, removals } = planned.plan;

  const log = await getRequestLogger();
  let applied = 0;

  // 複数件の変更は個別の呼び出しになるため厳密には原子的でない。途中で失敗したら止め、
  // 反映済みの件数を伝える。
  for (const change of [...promotions, ...demotions]) {
    const { error } = await admin.rpc('change_member_role', {
      p_actor_id: caller.id,
      p_target_user_id: change.memberId,
      p_role: change.role,
    });
    if (error) {
      const known = ROLE_CHANGE_ERROR_MESSAGES[error.code ?? ''];
      if (!known) {
        log.error({ error, memberId: change.memberId }, 'メンバーのロールの変更に失敗しました');
      }
      return {
        ok: false,
        error: withAppliedCount(known ?? 'ロールの変更に失敗しました', applied),
      };
    }
    applied += 1;
  }

  for (const removal of removals) {
    // auth.users を消せば profiles は on delete cascade で消える。
    const { error } = await admin.auth.admin.deleteUser(removal.memberId);
    if (error) {
      log.error({ error, memberId: removal.memberId }, 'メンバーの削除に失敗しました');
      return {
        ok: false,
        error: withAppliedCount('メンバーの削除に失敗しました', applied),
      };
    }
    applied += 1;

    // 削除はもう取り消せないので、記録に失敗しても成功として返し、ログにだけ残す。
    const { error: auditError } = await admin.from('system_audit_logs').insert({
      organizationId: caller.organizationId,
      userId: caller.id,
      action: 'member.remove',
      entityName: 'profiles',
      entityId: removal.memberId,
      detail: JSON.stringify({ role: removal.role }),
    });
    if (auditError) {
      log.error({ error: auditError, memberId: removal.memberId }, 'メンバーの削除の記録に失敗しました');
    }
  }

  return { ok: true, data: undefined };
};
