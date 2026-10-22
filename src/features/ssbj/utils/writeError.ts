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

/**
 * 古い画面から保存しようとして、読込後に他の画面で保存された変更を上書きしそうになったときのメッセージ（docs/ssbj-spec.md §8）。
 * 入力中の値は画面に残し、最新の内容を確かめてから入力し直してもらう（古い値と最新の値を自動で混ぜ合わせない）。
 */
export const SSBJ_EDIT_CONFLICT_MESSAGE =
  '他の画面で更新されました。最新の内容を確認して再編集してください（この画面の変更は保存していません）';

/** 読込時から対象の行が変わっていたため、保存しなかった。画面はこれを見て最新の内容を読み直す。 */
export class SsbjEditConflictError extends Error {
  constructor() {
    super(SSBJ_EDIT_CONFLICT_MESSAGE);
    this.name = 'SsbjEditConflictError';
  }
}
