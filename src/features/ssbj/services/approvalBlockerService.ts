// ログイン中の利用者が SSBJ レポートを承認できない理由（自己承認の判定。docs/ssbj-spec.md §13「状態管理と承認ロック」）を
// サーバに問い合わせる。ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。
// 正本の判定は状態の変更（change_ssbj_report_status）が行い、ここは承認ボタンを押す前に理由を出すための案内用。

import { createClient } from '@/lib/supabase/client';
import { SSBJ_APPROVAL_BLOCKERS, type SsbjApprovalBlocker } from '../types';

/** 承認できない理由。承認してよければ null（指定された承認者か管理者かは別に判定する）。 */
export const getMySsbjApprovalBlocker = async (reportId: string): Promise<SsbjApprovalBlocker | null> => {
  const { data, error } = await createClient().rpc('ssbj_my_approval_blocker', { p_report_id: reportId });
  if (error) throw new Error('承認できるかどうかを確認できませんでした');
  if (data === null) return null;
  if (typeof data === 'string' && (SSBJ_APPROVAL_BLOCKERS as readonly string[]).includes(data)) {
    return data as SsbjApprovalBlocker;
  }
  throw new Error('承認できるかどうかの確認結果が不正です');
};
