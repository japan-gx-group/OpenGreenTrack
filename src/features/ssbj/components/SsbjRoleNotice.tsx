// SSBJ のロールが入力担当でも管理者でもない利用者に、作業中の内容を編集できないことを伝える案内（表示のみ）。
// 編集の操作は出さない（DB の RLS も変更を止める。docs/authorization-matrix.md §2.1）。

import { Eye } from 'lucide-react';
import { SSBJ_ROLE_LABELS, type SsbjEffectiveRole } from '../types';
import { canEditSsbj } from '../utils/memberRole';

export const SsbjRoleNotice = ({ role, isLoading }: { role: SsbjEffectiveRole | null; isLoading: boolean }) => {
  if (isLoading || canEditSsbj(role)) return null;
  return (
    <div role="status" data-testid="ssbj-role-notice"
      className="flex items-start gap-2 rounded-md bg-muted px-4 py-3 text-sm text-text-muted">
      <Eye aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <p className="m-0">
        {role ? `SSBJ のロールが${SSBJ_ROLE_LABELS[role]}のため、` : 'SSBJ のロールを確かめられないため、'}
        内容を見ることはできますが、編集はできません。編集できるのは入力担当か管理者です。
      </p>
    </div>
  );
};
