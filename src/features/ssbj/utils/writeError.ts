// SSBJ の作業中データへの書き込みが失敗したときの、利用者向けのメッセージ。
// 承認済みのレポートは DB が変更を止める（P2051。supabase/migrations/20261002090100_ssbj_report_status.sql）ので、
// その場合は「保存に失敗しました」ではなく、理由と次の手順を伝える。

/** 承認済みのレポートへの変更を DB が止めたときの SQLSTATE。 */
export const SSBJ_LOCKED_SQLSTATE = 'P2051';

export const SSBJ_LOCKED_MESSAGE =
  '承認済みのレポートは変更できません。変更するには、管理者か承認者が差戻してください';

/** 書き込みエラーを利用者向けのメッセージにする。承認済みで止められた場合以外は fallback を返す。 */
export const ssbjWriteErrorMessage = (error: { code?: string } | null | undefined, fallback: string): string =>
  error?.code === SSBJ_LOCKED_SQLSTATE ? SSBJ_LOCKED_MESSAGE : fallback;
