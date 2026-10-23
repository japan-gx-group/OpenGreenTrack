// メンバー管理の「変更を保存」で受け取る変更（ロールの変更・メンバーの削除）を検証し、
// 反映する順番に並べる純関数。Server Action（members.ts）とテストで共有する
// （'use server' のファイルは async 関数しか export できないため分けている）。

import {
  isAdmin,
  isAssignableMemberRole,
  type AssignableMemberRole,
  type MemberRole,
} from '@/types/role';

export interface MemberRoleChange {
  /** ロールを変えるメンバーの profiles.id */
  memberId: string;
  /** 変更後のロール（'admin' = 管理者 / 'logger' = メンバー） */
  role: AssignableMemberRole;
}

export interface MemberChangesInput {
  /** 削除するメンバーの profiles.id（= auth.users.id） */
  removedMemberIds: string[];
  /** ロールを変えるメンバー */
  roleChanges?: MemberRoleChange[];
}

/** 保存の時点で DB にある自組織のメンバー */
export interface CurrentMember {
  id: string;
  role: MemberRole;
}

export interface MemberRemoval {
  memberId: string;
  /** 削除する時点のロール（監査ログに残す） */
  role: MemberRole;
}

/**
 * 反映の順番は「管理者への昇格 → メンバーへの降格 → 削除」。
 * 「別の人を管理者にして、自分をメンバーにする」を 1 回で保存しても、途中で管理者が 0 人にならないようにするため。
 */
export interface MemberChangePlan {
  promotions: MemberRoleChange[];
  demotions: MemberRoleChange[];
  removals: MemberRemoval[];
}

export type MemberChangePlanResult =
  | { ok: true; plan: MemberChangePlan }
  | { ok: false; error: string };

export const LAST_ADMIN_MESSAGE = '管理者が 1 人もいなくなるため変更できません';

const isRoleChange = (value: unknown): value is MemberRoleChange => {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as Record<string, unknown>;
  return typeof change.memberId === 'string' && isAssignableMemberRole(change.role);
};

export const planMemberChanges = (
  members: CurrentMember[],
  input: MemberChangesInput,
  callerId: string,
): MemberChangePlanResult => {
  // Server Action はブラウザから任意の値で呼べるため、形から確かめる。
  const removedMemberIds: unknown = input.removedMemberIds ?? [];
  const roleChanges: unknown = input.roleChanges ?? [];
  if (
    !Array.isArray(removedMemberIds) ||
    !Array.isArray(roleChanges) ||
    removedMemberIds.some((id) => typeof id !== 'string') ||
    !roleChanges.every(isRoleChange)
  ) {
    return { ok: false, error: '変更内容が正しくありません' };
  }
  const removedIds = removedMemberIds as string[];
  const changes = roleChanges as MemberRoleChange[];

  const touchedIds = [...removedIds, ...changes.map((change) => change.memberId)];
  if (new Set(touchedIds).size !== touchedIds.length) {
    return { ok: false, error: '同じメンバーへの変更が重複しています' };
  }

  // 自分自身の削除は禁止（誤操作の防止。アカウント削除は設定＞アカウントから行う）。
  if (removedIds.includes(callerId)) {
    return { ok: false, error: '自分自身の削除はできません' };
  }

  // service_role は RLS を越えるため、他組織の id を混ぜられても弾けるようにする。
  const currentById = new Map(members.map((member) => [member.id, member]));
  if (touchedIds.some((id) => !currentById.has(id))) {
    return { ok: false, error: '組織に存在しないメンバーが含まれています' };
  }

  // 管理者かどうかが変わる変更だけを残す（'viewer' → 'logger' のような変更は何もしない）。
  const wasAdmin = (memberId: string) => isAdmin(currentById.get(memberId)?.role);
  const promotions = changes.filter((change) => isAdmin(change.role) && !wasAdmin(change.memberId));
  const demotions = changes.filter((change) => !isAdmin(change.role) && wasAdmin(change.memberId));

  const removedSet = new Set(removedIds);
  const removals = members
    .filter((member) => removedSet.has(member.id))
    .map((member) => ({ memberId: member.id, role: member.role }));

  // すべて反映したあとに、管理者が 1 人以上残るか（DB のトリガーも最後に止めるが、分かりやすく先に断る）。
  const roleAfter = new Map<string, MemberRole>(members.map((member) => [member.id, member.role]));
  for (const change of changes) {
    roleAfter.set(change.memberId, change.role);
  }
  const adminsAfter = members.filter(
    (member) => !removedSet.has(member.id) && isAdmin(roleAfter.get(member.id)),
  ).length;
  if (adminsAfter === 0) {
    return { ok: false, error: LAST_ADMIN_MESSAGE };
  }

  return { ok: true, plan: { promotions, demotions, removals } };
};
