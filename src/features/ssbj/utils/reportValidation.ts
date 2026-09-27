// SSBJ レポートの基本情報の入力検証と正規化（純関数）。
// 作成ダイアログと詳細画面の編集フォームで同じ上限・同じ文言を使うためにここへ集約する。
// 上限は ssbj_reports の列（title varchar(200) / "standardVersion" varchar(100)）に合わせ、
// 超えた入力が DB エラー（汎用メッセージ）になる前に入力段階で弾く。text 列の作成目的・報告範囲は
// DB に上限が無いが、画面で扱える長さに抑えるため上限を設ける。
// 項目名と必須性は初回レポート例の合意待ちの仮置き（docs/ssbj-spec.md §12）。

export const SSBJ_REPORT_TITLE_MAX_LENGTH = 200;
export const SSBJ_REPORT_TEXT_MAX_LENGTH = 2000;
export const SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH = 100;

export const SSBJ_REPORT_TITLE_REQUIRED_MESSAGE = 'レポート名を入力してください';

/** フォームの入力値（未入力は空文字）。 */
export type SsbjReportFormValues = {
  title: string;
  purpose: string;
  reportingScope: string;
  standardVersion: string;
};

/** 保存する基本情報（前後の空白を落とし、未入力の任意項目は null）。 */
export type SsbjReportBasicInfoInput = {
  title: string;
  purpose: string | null;
  reportingScope: string | null;
  standardVersion: string | null;
};

export const EMPTY_SSBJ_REPORT_FORM_VALUES: SsbjReportFormValues = {
  title: '',
  purpose: '',
  reportingScope: '',
  standardVersion: '',
};

const toNullable = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * 入力値を保存用に整える。任意項目の未入力は空文字ではなく null にする
 * （空文字を「入力済み」として残さない。docs/ssbj-spec.md §4 と同じ考え方）。
 */
export const normalizeSsbjReportInput = (values: SsbjReportFormValues): SsbjReportBasicInfoInput => ({
  title: values.title.trim(),
  purpose: toNullable(values.purpose),
  reportingScope: toNullable(values.reportingScope),
  standardVersion: toNullable(values.standardVersion),
});

/** 正規化済みの入力を検証する。問題が無ければ空配列。複数の問題は全件返す。 */
export const validateSsbjReportInput = (input: SsbjReportBasicInfoInput): string[] => {
  const errors: string[] = [];
  if (!input.title) errors.push(SSBJ_REPORT_TITLE_REQUIRED_MESSAGE);
  if (input.title.length > SSBJ_REPORT_TITLE_MAX_LENGTH) {
    errors.push(`レポート名は${SSBJ_REPORT_TITLE_MAX_LENGTH}文字以内で入力してください`);
  }
  if ((input.purpose?.length ?? 0) > SSBJ_REPORT_TEXT_MAX_LENGTH) {
    errors.push(`作成目的は${SSBJ_REPORT_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  if ((input.reportingScope?.length ?? 0) > SSBJ_REPORT_TEXT_MAX_LENGTH) {
    errors.push(`報告範囲は${SSBJ_REPORT_TEXT_MAX_LENGTH}文字以内で入力してください`);
  }
  if ((input.standardVersion?.length ?? 0) > SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH) {
    errors.push(`参照する基準の版は${SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH}文字以内で入力してください`);
  }
  return errors;
};

/** 保存済みの基本情報をフォームの入力値へ戻す（編集開始時に使う）。 */
export const toSsbjReportFormValues = (input: SsbjReportBasicInfoInput): SsbjReportFormValues => ({
  title: input.title,
  purpose: input.purpose ?? '',
  reportingScope: input.reportingScope ?? '',
  standardVersion: input.standardVersion ?? '',
});
