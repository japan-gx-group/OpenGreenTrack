'use server';

// メンバー管理（メンバー削除）の Server Action。
//
// なぜ service_role（admin client）を使うか:
//   - メンバー削除は auth.users の削除（profiles へ on delete cascade）まで必要で、
//     authenticated のクライアントにはその権限がない。
//
// 呼び出し元は Cookie セッションからサーバ側で確認する（getCurrentProfile）。
// ロールによる絞り込みは行わない（ロール判定は無効）。ただし service_role は
// RLS を越えるため、「対象が自組織のメンバーか」の確認はここでしか担保できない。
//
// profiles.role の変更 API はロール判定の廃止に合わせて削除した。role 列は GRANT 対象外のままなので、
// 直接 supabase-js から UPDATE することもできない。

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentProfile } from '@/lib/currentProfile';
import type { ActionResult } from '@/types/actionResult';

export interface MemberChangesInput {
  /** 削除するメンバーの profiles.id（= auth.users.id） */
  removedMemberIds: string[];
}

// メンバー一覧画面の「下書き→保存」でまとめて確定するため、変更を一括で受け取る。
export const saveMemberChanges = async (
  input: MemberChangesInput,
): Promise<ActionResult> => {
  const caller = await getCurrentProfile();
  if (!caller) {
    return { ok: false, error: 'セッションが確認できません。ログインし直してください' };
  }

  const removedMemberIds = input.removedMemberIds ?? [];
  if (removedMemberIds.length === 0) {
    return { ok: true, data: undefined };
  }

  // 自分自身の削除は禁止（誤操作の防止。アカウント削除は設定＞アカウントから行う）。
  const targetIds = removedMemberIds;
  if (targetIds.includes(caller.id)) {
    return { ok: false, error: '自分自身の削除はできません' };
  }

  const admin = createAdminClient();

  // 対象が全員「自組織のメンバー」であることをサーバ側でも確認する
  // （service_role は RLS を越えるため、他組織の id を混ぜられても弾けるように）。
  const { data: targets, error: targetsError } = await admin
    .from('profiles')
    .select('id')
    .eq('organizationId', caller.organizationId)
    .in('id', targetIds);
  if (targetsError) {
    return { ok: false, error: 'メンバー情報の確認に失敗しました' };
  }
  const knownIds = new Set((targets ?? []).map((row) => row.id as string));
  if (targetIds.some((id) => !knownIds.has(id))) {
    return { ok: false, error: '組織に存在しないメンバーが含まれています' };
  }

  // 複数件の削除は個別HTTPになるため厳密には原子的でない。途中失敗時は
  // 「一部のみ反映された可能性」を伝え、画面側で一覧を取り直して整合させる。
  for (const memberId of removedMemberIds) {
    // auth.users を消せば profiles は on delete cascade で消える。
    const { error } = await admin.auth.admin.deleteUser(memberId);
    if (error) {
      return {
        ok: false,
        error: 'メンバーの削除に失敗しました（一部のみ反映された可能性があります）',
      };
    }
  }

  return { ok: true, data: undefined };
};
