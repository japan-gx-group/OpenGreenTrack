import { describe, expect, it } from 'vitest';
import {
  EMPTY_SSBJ_REPORT_FORM_VALUES,
  SSBJ_REPORT_OWNERSHIP_PERCENTAGE_MESSAGE,
  SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH,
  SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH,
  SSBJ_REPORT_TEXT_MAX_LENGTH,
  SSBJ_REPORT_TITLE_MAX_LENGTH,
  SSBJ_REPORT_TITLE_REQUIRED_MESSAGE,
  normalizeSsbjReportInput,
  toSsbjReportFormValues,
  validateSsbjReportInput,
  type SsbjReportBasicInfoInput,
} from '../reportValidation';

const EMPTY_INPUT: SsbjReportBasicInfoInput = normalizeSsbjReportInput({
  ...EMPTY_SSBJ_REPORT_FORM_VALUES,
  title: 'レポート',
});

describe('normalizeSsbjReportInput', () => {
  it('前後の空白を落とし、任意項目の未入力（空白のみを含む）・未選択は null にする', () => {
    expect(
      normalizeSsbjReportInput({
        ...EMPTY_SSBJ_REPORT_FORM_VALUES,
        title: '  レポート  ',
        purpose: '   ',
        reportingScope: ' 単体 ',
        parentCompanyName: ' 架空ホールディングス株式会社 ',
        ownershipPercentage: ' 80.5 ',
      }),
    ).toEqual({
      title: 'レポート',
      purpose: null,
      reportingScope: '単体',
      standardVersion: null,
      parentCompanyName: '架空ホールディングス株式会社',
      parentRelationship: null,
      ownershipPercentage: '80.5',
      measurementApproach: null,
      industryCode: null,
    });
  });
});

describe('validateSsbjReportInput', () => {
  it('タイトルだけ入っていれば問題なし', () => {
    expect(validateSsbjReportInput(EMPTY_INPUT)).toEqual([]);
  });

  it('タイトルが空白だけなら必須エラー', () => {
    const input = normalizeSsbjReportInput({ ...EMPTY_SSBJ_REPORT_FORM_VALUES, title: '   ' });
    expect(validateSsbjReportInput(input)).toEqual([SSBJ_REPORT_TITLE_REQUIRED_MESSAGE]);
  });

  it('各項目の上限を超えたらすべて返す', () => {
    const errors = validateSsbjReportInput({
      ...EMPTY_INPUT,
      title: 'a'.repeat(SSBJ_REPORT_TITLE_MAX_LENGTH + 1),
      purpose: 'a'.repeat(SSBJ_REPORT_TEXT_MAX_LENGTH + 1),
      reportingScope: 'a'.repeat(SSBJ_REPORT_TEXT_MAX_LENGTH + 1),
      standardVersion: 'a'.repeat(SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH + 1),
      parentCompanyName: 'a'.repeat(SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH + 1),
    });
    expect(errors).toHaveLength(5);
  });

  it('上限ちょうど・選択肢の値は許可する', () => {
    expect(
      validateSsbjReportInput({
        title: 'a'.repeat(SSBJ_REPORT_TITLE_MAX_LENGTH),
        purpose: 'a'.repeat(SSBJ_REPORT_TEXT_MAX_LENGTH),
        reportingScope: null,
        standardVersion: 'a'.repeat(SSBJ_REPORT_STANDARD_VERSION_MAX_LENGTH),
        parentCompanyName: 'a'.repeat(SSBJ_REPORT_PARENT_COMPANY_NAME_MAX_LENGTH),
        parentRelationship: 'equity_method_affiliate',
        ownershipPercentage: '100',
        measurementApproach: 'equity_share',
        industryCode: 'TR-RO',
      }),
    ).toEqual([]);
  });

  it.each(['0', '100.01', '-5', '12.345', '八十', '1e2', ''])('持分比率「%s」はエラー', value => {
    expect(validateSsbjReportInput({ ...EMPTY_INPUT, ownershipPercentage: value })).toEqual([
      SSBJ_REPORT_OWNERSHIP_PERCENTAGE_MESSAGE,
    ]);
  });

  it.each(['0.01', '35', '80.5', '100.00'])('持分比率「%s」は許可する', value => {
    expect(validateSsbjReportInput({ ...EMPTY_INPUT, ownershipPercentage: value })).toEqual([]);
  });

  it('一覧に無い業種コードはエラー', () => {
    expect(validateSsbjReportInput({ ...EMPTY_INPUT, industryCode: 'XX-YY' })).toEqual(['業種を一覧から選んでください']);
  });
});

describe('toSsbjReportFormValues', () => {
  it('null は空文字に戻し、正規化と往復しても変わらない', () => {
    const input: SsbjReportBasicInfoInput = {
      ...EMPTY_INPUT,
      reportingScope: '単体',
      parentRelationship: 'consolidated_subsidiary',
      ownershipPercentage: '80.5',
      industryCode: 'RT-IG',
    };
    const values = toSsbjReportFormValues(input);
    expect(values).toMatchObject({ purpose: '', standardVersion: '', parentCompanyName: '', measurementApproach: '' });
    expect(normalizeSsbjReportInput(values)).toEqual(input);
  });
});
