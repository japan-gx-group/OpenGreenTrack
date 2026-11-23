import { describe, expect, it } from 'vitest';
import { FICTIONAL_FISCAL_YEAR_ID, fictionalReductionTarget } from '../../__fixtures__/fictionalReport';
import {
  formatReportYearReduction,
  formatTargetGap,
  reductionTargetGap,
  toSsbjReductionTarget,
} from '../reductionTarget';

// ssbj_ogt_reduction_target が返す形（数値は numeric を text にしたもの）。
const raw = {
  status: 'set',
  baseFiscalYear: { id: 'base-year', label: '2022年度', startDate: '2022-04-01', endDate: '2023-03-31' },
  baseYearEnded: true,
  baseYearEmissions: '1000',
  reportFiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
  reportYear: 2024,
  reportYearEmissions: '900.25',
  targetYears: [
    { targetYear: 2025, reductionPercent: '20', targetEmissions: '800' },
  ],
};

describe('toSsbjReductionTarget', () => {
  it('目標が無ければ not_set', () => {
    expect(toSsbjReductionTarget({ status: 'not_set' })).toEqual({ status: 'not_set' });
  });

  it('レポートの年度に削減率が無ければ、その年度は「目標未設定」にし、0% にしない', () => {
    const target = toSsbjReductionTarget(raw);
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.reportYear).toEqual({
      fiscalYearId: FICTIONAL_FISCAL_YEAR_ID,
      targetYear: 2024,
      reductionPercent: { state: 'unanswered' },
      targetEmissions: { state: 'unanswered' },
      actualEmissions: { state: 'answered', value: '900.25' },
    });
    expect(formatReportYearReduction(target)).toBe('目標未設定');
    expect(reductionTargetGap(target)).toEqual({ state: 'unanswered' });
  });

  it('レポートの年度に削減率があれば、その年度の目標排出量を使う。集計の無い年度の排出量は未算定にする', () => {
    const target = toSsbjReductionTarget({
      ...raw,
      reportYearEmissions: null,
      targetYears: [{ targetYear: 2024, reductionPercent: '12.5', targetEmissions: '875' }],
    });
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.reportYear.reductionPercent).toEqual({ state: 'answered', value: '12.5' });
    expect(target.reportYear.targetEmissions).toEqual({ state: 'answered', value: '875' });
    expect(target.reportYear.actualEmissions).toEqual({ state: 'unanswered' });
  });

  it('数値の形でない値・形の崩れた結果は例外にする（0 にしない）', () => {
    expect(() => toSsbjReductionTarget({ ...raw, baseYearEmissions: 1000 })).toThrow();
    expect(() => toSsbjReductionTarget({ ...raw, targetYears: [{ targetYear: 2025, reductionPercent: 20 }] })).toThrow();
    expect(() => toSsbjReductionTarget(null)).toThrow();
    expect(() => toSsbjReductionTarget({ status: 'unknown' })).toThrow();
  });
});

describe('reductionTargetGap / formatTargetGap', () => {
  it('実績 − 目標を丸めずに出す', () => {
    expect(reductionTargetGap(fictionalReductionTarget)).toEqual({ state: 'answered', value: '25.25' });
    expect(formatTargetGap({ state: 'answered', value: '25.25' })).toBe('目標を 25.25 t-CO2e 上回る');
    expect(formatTargetGap({ state: 'answered', value: '-1234.5' })).toBe('目標を 1,234.5 t-CO2e 下回る');
    expect(formatTargetGap({ state: 'answered', value: '0' })).toBe('目標と同じ');
    expect(formatTargetGap({ state: 'unanswered' })).toBe('—');
  });
});
