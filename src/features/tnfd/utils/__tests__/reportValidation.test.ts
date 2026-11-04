import { describe, expect, it } from 'vitest';
import {
  EMPTY_TNFD_REPORT_FORM_VALUES,
  TNFD_REPORT_STANDARD_VERSION_MAX_LENGTH,
  TNFD_REPORT_TEXT_MAX_LENGTH,
  TNFD_REPORT_TITLE_MAX_LENGTH,
  TNFD_REPORT_TITLE_REQUIRED_MESSAGE,
  normalizeTnfdReportInput,
  toTnfdReportFormValues,
  validateTnfdReportInput,
} from '../reportValidation';

describe('normalizeTnfdReportInput', () => {
  it('前後の空白を落とし、任意項目の未入力（空白のみを含む）は null にする', () => {
    expect(
      normalizeTnfdReportInput({
        title: '  レポート  ',
        purpose: '   ',
        reportingScope: ' 単体 ',
        standardVersion: '',
      }),
    ).toEqual({ title: 'レポート', purpose: null, reportingScope: '単体', standardVersion: null });
  });
});

describe('validateTnfdReportInput', () => {
  const valid = normalizeTnfdReportInput({ ...EMPTY_TNFD_REPORT_FORM_VALUES, title: 'レポート' });

  it('タイトルだけ入っていれば問題なし', () => {
    expect(validateTnfdReportInput(valid)).toEqual([]);
  });

  it('タイトルが空白だけなら必須エラー', () => {
    const input = normalizeTnfdReportInput({ ...EMPTY_TNFD_REPORT_FORM_VALUES, title: '   ' });
    expect(validateTnfdReportInput(input)).toEqual([TNFD_REPORT_TITLE_REQUIRED_MESSAGE]);
  });

  it('各項目の上限を超えたらすべて返す', () => {
    const errors = validateTnfdReportInput({
      title: 'a'.repeat(TNFD_REPORT_TITLE_MAX_LENGTH + 1),
      purpose: 'a'.repeat(TNFD_REPORT_TEXT_MAX_LENGTH + 1),
      reportingScope: 'a'.repeat(TNFD_REPORT_TEXT_MAX_LENGTH + 1),
      standardVersion: 'a'.repeat(TNFD_REPORT_STANDARD_VERSION_MAX_LENGTH + 1),
    });
    expect(errors).toHaveLength(4);
  });

  it('上限ちょうどは許可する', () => {
    expect(
      validateTnfdReportInput({
        title: 'a'.repeat(TNFD_REPORT_TITLE_MAX_LENGTH),
        purpose: 'a'.repeat(TNFD_REPORT_TEXT_MAX_LENGTH),
        reportingScope: null,
        standardVersion: 'a'.repeat(TNFD_REPORT_STANDARD_VERSION_MAX_LENGTH),
      }),
    ).toEqual([]);
  });
});

describe('toTnfdReportFormValues', () => {
  it('null は空文字に戻し、正規化と往復しても変わらない', () => {
    const input = { title: 'レポート', purpose: null, reportingScope: '単体', standardVersion: null };
    const values = toTnfdReportFormValues(input);
    expect(values).toEqual({ title: 'レポート', purpose: '', reportingScope: '単体', standardVersion: '' });
    expect(normalizeTnfdReportInput(values)).toEqual(input);
  });
});
