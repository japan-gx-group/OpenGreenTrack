import { describe, expect, it } from 'vitest';
import {
  EMPTY_SSBJ_REPORT_FORM_VALUES,
  SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH,
  SSBJ_REPORT_TEXT_MAX_LENGTH,
  SSBJ_REPORT_TITLE_MAX_LENGTH,
  SSBJ_REPORT_TITLE_REQUIRED_MESSAGE,
  normalizeSsbjReportInput,
  toSsbjReportFormValues,
  validateSsbjReportInput,
} from '../reportValidation';

describe('normalizeSsbjReportInput', () => {
  it('前後の空白を落とし、任意項目の未入力（空白のみを含む）は null にする', () => {
    expect(
      normalizeSsbjReportInput({
        title: '  レポート  ',
        purpose: '   ',
        reportingScope: ' 単体 ',
        standardVersion: '',
      }),
    ).toEqual({ title: 'レポート', purpose: null, reportingScope: '単体', standardVersion: null });
  });
});

describe('validateSsbjReportInput', () => {
  const valid = normalizeSsbjReportInput({ ...EMPTY_SSBJ_REPORT_FORM_VALUES, title: 'レポート' });

  it('タイトルだけ入っていれば問題なし', () => {
    expect(validateSsbjReportInput(valid)).toEqual([]);
  });

  it('タイトルが空白だけなら必須エラー', () => {
    const input = normalizeSsbjReportInput({ ...EMPTY_SSBJ_REPORT_FORM_VALUES, title: '   ' });
    expect(validateSsbjReportInput(input)).toEqual([SSBJ_REPORT_TITLE_REQUIRED_MESSAGE]);
  });

  it('各項目の上限を超えたらすべて返す', () => {
    const errors = validateSsbjReportInput({
      title: 'a'.repeat(SSBJ_REPORT_TITLE_MAX_LENGTH + 1),
      purpose: 'a'.repeat(SSBJ_REPORT_TEXT_MAX_LENGTH + 1),
      reportingScope: 'a'.repeat(SSBJ_REPORT_TEXT_MAX_LENGTH + 1),
      standardVersion: 'a'.repeat(SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH + 1),
    });
    expect(errors).toHaveLength(4);
  });

  it('上限ちょうどは許可する', () => {
    expect(
      validateSsbjReportInput({
        title: 'a'.repeat(SSBJ_REPORT_TITLE_MAX_LENGTH),
        purpose: 'a'.repeat(SSBJ_REPORT_TEXT_MAX_LENGTH),
        reportingScope: null,
        standardVersion: 'a'.repeat(SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH),
      }),
    ).toEqual([]);
  });
});

describe('toSsbjReportFormValues', () => {
  it('null は空文字に戻し、正規化と往復しても変わらない', () => {
    const input = { title: 'レポート', purpose: null, reportingScope: '単体', standardVersion: null };
    const values = toSsbjReportFormValues(input);
    expect(values).toEqual({ title: 'レポート', purpose: '', reportingScope: '単体', standardVersion: '' });
    expect(normalizeSsbjReportInput(values)).toEqual(input);
  });
});
