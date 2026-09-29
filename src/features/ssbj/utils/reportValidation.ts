// SSBJ レポートの基本情報の入力検証と正規化（純関数）。
// 作成ダイアログと詳細画面の編集フォームで同じ上限・同じ文言を使うためにここへ集約する。
// 上限は ssbj_reports の列（title・parentCompanyName varchar(200) / "standardVersion" varchar(100)）に合わせ、
// 超えた入力が DB エラー（汎用メッセージ）になる前に入力段階で弾く。text 列の作成目的・報告範囲は
// DB に上限が無いが、画面で扱える長さに抑えるため上限を設ける。
// 項目と必須性は T01 の合意（docs/ssbj-r1-scope.md）。必須はレポート名だけ。

import {
  SSBJ_MEASUREMENT_APPROACHES,
  SSBJ_PARENT_RELATIONSHIPS,
  type SsbjMeasurementApproach,
  type SsbjParentRelationship,
} from '../types';
import { isDecimalString } from './decimal';
import { isSicsIndustryCode } from './sicsIndustries';

export const SSBJ_REPORT_TITLE_MAX_LENGTH = 200;
export const SSBJ_REPORT_TEXT_MAX_LENGTH = 2000;
export const SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH = 100;
export const SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH = 200;

export const SSBJ_REPORT_TITLE_REQUIRED_MESSAGE = 'レポート名を入力してください';
export const SSBJ_REPORT_OWNERSHIP_PERCENTAGE_MESSAGE =
  '持分比率は 0 より大きく 100 以下の数値（小数点以下 2 桁まで）で入力してください';

/** フォームの入力値（未入力・未選択は空文字）。 */
export type SsbjReportFormValues = {
  title: string;
  purpose: string;
  reportingScope: string;
  standardVersion: string;
  parentCompanyName: string;
  parentRelationship: SsbjParentRelationship | '';
  ownershipPercentage: string;
  measurementApproach: SsbjMeasurementApproach | '';
  industryCode: string;
};

/** 保存する基本情報（前後の空白を落とし、未入力の任意項目は null）。 */
export type SsbjReportBasicInfoInput = {
  title: string;
  purpose: string | null;
  reportingScope: string | null;
  standardVersion: string | null;
  parentCompanyName: string | null;
  parentRelationship: SsbjParentRelationship | null;
  ownershipPercentage: string | null;
  measurementApproach: SsbjMeasurementApproach | null;
  industryCode: string | null;
};

export const EMPTY_SSBJ_REPORT_FORM_VALUES: SsbjReportFormValues = {
  title: '',
  purpose: '',
  reportingScope: '',
  standardVersion: '',
  parentCompanyName: '',
  parentRelationship: '',
  ownershipPercentage: '',
  measurementApproach: '',
  industryCode: '',
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
  parentCompanyName: toNullable(values.parentCompanyName),
  parentRelationship: values.parentRelationship === '' ? null : values.parentRelationship,
  ownershipPercentage: toNullable(values.ownershipPercentage),
  measurementApproach: values.measurementApproach === '' ? null : values.measurementApproach,
  industryCode: toNullable(values.industryCode),
});

/** 0 より大きく 100 以下、小数点以下 2 桁まで（DB の numeric(5, 2) と check 制約に合わせる）。 */
const isOwnershipPercentage = (value: string): boolean => {
  if (!isDecimalString(value) || value.startsWith('-')) return false;
  const [, fraction = ''] = value.split('.');
  if (fraction.length > 2) return false;
  const number = Number(value);
  return number > 0 && number <= 100;
};

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
  if ((input.parentCompanyName?.length ?? 0) > SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH) {
    errors.push(`親会社名は${SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH}文字以内で入力してください`);
  }
  if (input.parentRelationship !== null && !SSBJ_PARENT_RELATIONSHIPS.includes(input.parentRelationship)) {
    errors.push('親会社との関係を一覧から選んでください');
  }
  if (input.ownershipPercentage !== null && !isOwnershipPercentage(input.ownershipPercentage)) {
    errors.push(SSBJ_REPORT_OWNERSHIP_PERCENTAGE_MESSAGE);
  }
  if (input.measurementApproach !== null && !SSBJ_MEASUREMENT_APPROACHES.includes(input.measurementApproach)) {
    errors.push('測定アプローチを一覧から選んでください');
  }
  if (input.industryCode !== null && !isSicsIndustryCode(input.industryCode)) {
    errors.push('業種を一覧から選んでください');
  }
  return errors;
};

/** 保存済みの基本情報をフォームの入力値へ戻す（編集開始時に使う）。 */
export const toSsbjReportFormValues = (input: SsbjReportBasicInfoInput): SsbjReportFormValues => ({
  title: input.title,
  purpose: input.purpose ?? '',
  reportingScope: input.reportingScope ?? '',
  standardVersion: input.standardVersion ?? '',
  parentCompanyName: input.parentCompanyName ?? '',
  parentRelationship: input.parentRelationship ?? '',
  ownershipPercentage: input.ownershipPercentage ?? '',
  measurementApproach: input.measurementApproach ?? '',
  industryCode: input.industryCode ?? '',
});
