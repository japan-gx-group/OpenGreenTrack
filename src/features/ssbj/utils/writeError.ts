// SSBJ の作業中データへの書き込みが失敗したときの、利用者向けのメッセージ。
// 承認済みのレポートは DB が変更を止める（P2051。supabase/migrations/20261002090100_ssbj_report_status.sql）。
// SSBJ のロールが入力担当でも管理者でもないときは RLS が止める（42501。20261010120000_ssbj_role_policies.sql）。
// どちらの場合も「保存に失敗しました」ではなく、理由と次の手順を伝える。

/** 承認済みのレポートへの変更を DB が止めたときの SQLSTATE。 */
export const SSBJ_LOCKED_SQLSTATE = 'P2051';

export const SSBJ_LOCKED_MESSAGE =
  '承認済みのレポートは変更できません。変更するには、管理者か承認者が差戻してください';

/** SSBJ のロールが書き込みを許さないとき（RLS の拒否）の SQLSTATE。docs/authorization-matrix.md §2.1。 */
export const SSBJ_FORBIDDEN_SQLSTATE = '42501';

export const SSBJ_FORBIDDEN_MESSAGE =
  'この操作の権限がありません。SSBJ のレポートの内容を変えられるのは、入力担当か管理者だけです';

/** 書き込みエラーを利用者向けのメッセージにする。承認済み・ロールで止められた場合以外は fallback を返す。 */
export const ssbjWriteErrorMessage = (error: { code?: string } | null | undefined, fallback: string): string => {
  if (error?.code === SSBJ_LOCKED_SQLSTATE) return SSBJ_LOCKED_MESSAGE;
  if (error?.code === SSBJ_FORBIDDEN_SQLSTATE) return SSBJ_FORBIDDEN_MESSAGE;
  return fallback;
};
