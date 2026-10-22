// SSBJ のロール（docs/authorization-matrix.md §1）の純関数: 値の検証と、利用者の SSBJ のロールの決め方・できることの判定。
// 判定の正本は DB（ssbj_user_role と RLS・RPC）で、ここは画面の出し分けのための写し。
// 画面が出し間違えても、DB と Route Handler が拒否する。

import type { MemberRole } from '@/types/role';
import {
  SSBJ_MEMBER_ROLES,
  SSBJ_ROLE_LABELS,
  type SsbjEffectiveRole,
  type SsbjMemberRole,
  type SsbjMemberRoleLog,
  type SsbjReportStatusAction,
} from '../types';

export const isSsbjMemberRole = (value: unknown): value is SsbjMemberRole =>
  typeof value === 'string' && (SSBJ_MEMBER_ROLES as readonly string[]).includes(value);

export const isSsbjEffectiveRole = (value: unknown): value is SsbjEffectiveRole =>
  value === 'admin' || isSsbjMemberRole(value);

/**
 * 利用者の SSBJ のロール（DB の ssbj_user_role と同じ規則）。OGT の管理者は割り当てに関係なく管理者、
 * それ以外は割り当てたロールで、割り当てが無ければ入力担当。
 */
export const effectiveSsbjRole = (ogtRole: MemberRole | null, assigned: SsbjMemberRole | null): SsbjEffectiveRole =>
  ogtRole === 'admin' ? 'admin' : assigned ?? 'editor';

/** 作業中データを編集できるか（入力担当か管理者）。 */
export const canEditSsbj = (role: SsbjEffectiveRole | null): boolean => role === 'admin' || role === 'editor';

/** 作業中データ・保存版・操作履歴を見られるか（閲覧者以外）。 */
export const canViewSsbjWorking = (role: SsbjEffectiveRole | null): boolean =>
  role === 'admin' || role === 'editor' || role === 'approver';

/** 承認者に指定でき、承認・差戻しができるロールか（承認担当か管理者）。 */
export const canApproveSsbj = (role: SsbjEffectiveRole | null): boolean => role === 'admin' || role === 'approver';

/**
 * 操作に要る権限（docs/authorization-matrix.md §2）。edit = 作業中データを変える（入力担当か管理者）、
 * view_working = 作業中の内容を見る（閲覧者以外）、approve = 承認・差戻し（承認担当か管理者）、
 * view_approved = 承認した保存版の開示する内容を見る（すべてのロール）。
 */
export type SsbjPermission = 'edit' | 'view_working' | 'approve' | 'view_approved';

export const ssbjRoleAllows = (role: SsbjEffectiveRole | null, permission: SsbjPermission): boolean => {
  switch (permission) {
    case 'edit':
      return canEditSsbj(role);
    case 'view_working':
      return canViewSsbjWorking(role);
    case 'approve':
      return canApproveSsbj(role);
    case 'view_approved':
      return role !== null;
  }
};

/** 状態の操作に要る権限。レビュー依頼・取り下げは書く人の操作、承認・差戻しは承認する人の操作。 */
export const ssbjStatusActionPermission = (action: SsbjReportStatusAction): SsbjPermission =>
  action === 'approve' || action === 'reopen' ? 'approve' : 'edit';

const PERMISSION_WHO: Record<SsbjPermission, string> = {
  edit: 'レポートの内容を変える操作は、入力担当か管理者だけができます',
  view_working: '作業中の内容は、閲覧者には見えません（承認した保存版だけを見られます）',
  approve: '承認・差戻しは、承認担当か管理者だけができます',
  view_approved: '承認した保存版は、組織の利用者だけが見られます',
};

/** ロールが操作を許さないときの、利用者向けのメッセージ。 */
export const ssbjForbiddenMessage = (role: SsbjEffectiveRole | null, permission: SsbjPermission): string =>
  role === null
    ? 'この操作の権限がありません'
    : `SSBJ のロールが${SSBJ_ROLE_LABELS[role]}のため、この操作はできません。${PERMISSION_WHO[permission]}`;

/** ロールの変更の記録の内容（画面に出す文）。memberLabel は対象の利用者の表示名。 */
export const ssbjMemberRoleLogText = (log: SsbjMemberRoleLog, memberLabel: string): string => {
  const label = (role: SsbjMemberRole | null): string => (role ? SSBJ_ROLE_LABELS[role] : '不明');
  switch (log.action) {
    case 'create':
      return `${memberLabel} を${label(log.role)}にした（割り当て）`;
    case 'update':
      return `${memberLabel} を${label(log.previousRole)}から${label(log.role)}に変えた`;
    case 'delete':
      return log.memberDeleted
        ? `${memberLabel} の割り当て（${label(log.previousRole)}）が、利用者の削除に伴い外れた`
        : `${memberLabel} の割り当て（${label(log.previousRole)}）を外した（入力担当に戻る）`;
  }
};
