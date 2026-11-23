import { describe, expect, it } from 'vitest';
import { FICTIONAL_FISCAL_YEAR_ID, fictionalReductionTarget } from '../../__fixtures__/fictionalReport';
import {
  formatReportYearReduction,
  formatTargetGap,
  hasCalculatedScopeTotals,
  isBaseYearUnusable,
  reductionTargetGap,
  toSsbjReductionTarget,
} from '../reductionTarget';
import type { OgtCandidateValue } from '../../types';

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

const calculated = { reportYearCalculated: true };

describe('toSsbjReductionTarget', () => {
  it('目標が無ければ not_set', () => {
    expect(toSsbjReductionTarget({ status: 'not_set' }, calculated)).toEqual({ status: 'not_set' });
  });

  it('レポートの年度に削減率が無ければ、その年度は「目標未設定」にし、0% にしない', () => {
    const target = toSsbjReductionTarget(raw, calculated);
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
    }, calculated);
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.reportYear.reductionPercent).toEqual({ state: 'answered', value: '12.5' });
    expect(target.reportYear.targetEmissions).toEqual({ state: 'answered', value: '875' });
    expect(target.reportYear.actualEmissions).toEqual({ state: 'unanswered' });
  });

  it('数値の形でない値・形の崩れた結果は例外にする（0 にしない）', () => {
    expect(() => toSsbjReductionTarget({ ...raw, baseYearEmissions: 1000 }, calculated)).toThrow();
    expect(() => toSsbjReductionTarget({ ...raw, targetYears: [{ targetYear: 2025, reductionPercent: 20 }] }, calculated)).toThrow();
    expect(() => toSsbjReductionTarget(null, calculated)).toThrow();
    expect(() => toSsbjReductionTarget({ status: 'unknown' }, calculated)).toThrow();
  });
});

describe('基準年度・レポートの年度が未算定のとき', () => {
  it('基準年度の集計が 0 なら、削減率は残し、目標排出量と差は算定できないものにする（0 の目標で超過にしない）', () => {
    const target = toSsbjReductionTarget({
      ...raw,
      baseYearEmissions: '0',
      reportYearEmissions: '80',
      targetYears: [{ targetYear: 2024, reductionPercent: '25', targetEmissions: '0' }],
    }, calculated);
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.targetYears).toEqual([{ targetYear: 2024, reductionPercent: '25', targetEmissions: { state: 'unanswered' } }]);
    expect(target.reportYear.reductionPercent).toEqual({ state: 'answered', value: '25' });
    expect(target.reportYear.targetEmissions).toEqual({ state: 'unanswered' });
    expect(target.reportYear.actualEmissions).toEqual({ state: 'answered', value: '80' });
    expect(reductionTargetGap(target)).toEqual({ state: 'unanswered' });
    expect(isBaseYearUnusable(target)).toBe(true);
  });

  it('基準年度の集計行が無い（null）ときも、目標排出量は算定できないものにする', () => {
    const target = toSsbjReductionTarget({
      ...raw,
      baseYearEmissions: null,
      targetYears: [{ targetYear: 2024, reductionPercent: '25', targetEmissions: null }],
    }, calculated);
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.reportYear.targetEmissions).toEqual({ state: 'unanswered' });
    expect(isBaseYearUnusable(target)).toBe(true);
  });

  it('基準年度に正の実績があり削減率が 100% なら、目標排出量は 0 として差を出す', () => {
    const target = toSsbjReductionTarget({
      ...raw,
      reportYearEmissions: '80',
      targetYears: [{ targetYear: 2024, reductionPercent: '100', targetEmissions: '0' }],
    }, calculated);
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.reportYear.targetEmissions).toEqual({ state: 'answered', value: '0' });
    expect(reductionTargetGap(target)).toEqual({ state: 'answered', value: '80' });
    expect(isBaseYearUnusable(target)).toBe(false);
  });

  it('レポートの年度の Scope 別候補がすべて未算定なら、集計行があっても実績を未算定にし、差を出さない', () => {
    const target = toSsbjReductionTarget({
      ...raw,
      reportYearEmissions: '0',
      targetYears: [{ targetYear: 2024, reductionPercent: '25', targetEmissions: '750' }],
    }, { reportYearCalculated: false });
    if (target.status !== 'set') throw new Error('set のはず');
    expect(target.reportYear.actualEmissions).toEqual({ state: 'unanswered' });
    expect(target.reportYear.targetEmissions).toEqual({ state: 'answered', value: '750' });
    expect(reductionTargetGap(target)).toEqual({ state: 'unanswered' });
  });
});

describe('hasCalculatedScopeTotals', () => {
  const candidate = (scope3CategoryId: number | null, answered: boolean) => ({
    scope3CategoryId,
    value: answered ? { state: 'answered', value: '10' } : { state: 'unanswered' },
  }) as unknown as OgtCandidateValue;

  it('Scope 1・2・3 の合計の候補値がすべて未算定なら false（カテゴリ別の値は見ない）', () => {
    expect(hasCalculatedScopeTotals([candidate(null, false), candidate(null, false), candidate(null, false), candidate(1, true)])).toBe(false);
  });

  it('どれか 1 つでも算定済みなら true', () => {
    expect(hasCalculatedScopeTotals([candidate(null, false), candidate(null, true), candidate(null, false)])).toBe(true);
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
