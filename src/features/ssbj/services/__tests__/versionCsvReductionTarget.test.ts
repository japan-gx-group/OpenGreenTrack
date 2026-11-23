import { describe, expect, it } from 'vitest';
import { fictionalGhgAdoption, fictionalReductionTarget } from '../../__fixtures__/fictionalReport';
import { ghgAdoptionCsvRows } from '../versionCsvGhg';
import { reductionTargetCsvRows } from '../versionCsvReductionTarget';

const byId = (rows: string[][]) => new Map(rows.map(row => [row[1], row]));

describe('reductionTargetCsvRows', () => {
  it('基準年度・年度ごとの削減率と目標・レポートの年度の目標と実績と差を、採用した値のまま出す', () => {
    const rows = byId(reductionTargetCsvRows(fictionalGhgAdoption));
    expect(rows.get('reduction_target.base_year')?.[4]).toBe('2022年度（2022-04-01〜2023-03-31）');
    expect(rows.get('reduction_target.base_year_emissions')?.slice(3, 6)).toEqual(['入力済み', '1000', 't-CO2e']);
    expect(rows.get('reduction_target.2025.reduction_percent')?.slice(3, 6)).toEqual(['入力済み', '20', '%']);
    expect(rows.get('reduction_target.2025.target_emissions')?.slice(3, 6)).toEqual(['入力済み', '800', 't-CO2e']);
    expect(rows.get('reduction_target.report_year.reduction_percent')?.[4]).toBe('12.5');
    expect(rows.get('reduction_target.report_year.target_emissions')?.[4]).toBe('875');
    expect(rows.get('reduction_target.report_year.actual_emissions')?.[4]).toBe('900.25');
    expect(rows.get('reduction_target.report_year.gap')?.[4]).toBe('25.25');
    expect([...rows.values()].every(row => row.length === 8)).toBe(true);
  });

  it('レポートの年度に削減率が無ければ「未設定」にして 0 を入れない。基準年度が期中だったことを注記する', () => {
    if (fictionalReductionTarget.status !== 'set') throw new Error('fixture');
    const rows = byId(reductionTargetCsvRows({
      ...fictionalGhgAdoption,
      reductionTarget: {
        ...fictionalReductionTarget,
        baseYearEnded: false,
        reportYear: {
          ...fictionalReductionTarget.reportYear,
          reductionPercent: { state: 'unanswered' },
          targetEmissions: { state: 'unanswered' },
        },
      },
    }));
    expect(rows.get('reduction_target.report_year.reduction_percent')?.slice(3, 5)).toEqual(['未設定', '']);
    expect(rows.get('reduction_target.report_year.target_emissions')?.slice(3, 5)).toEqual(['未設定', '']);
    expect(rows.get('reduction_target.report_year.gap')?.slice(3, 5)).toEqual(['算定できない', '']);
    expect(rows.get('reduction_target.base_year')?.[7]).toContain('期中の累計');
  });

  it('OGT に目標が無ければ「未設定」、目標を一緒に採用する前の採用は「未採用」の 1 行にする', () => {
    expect(reductionTargetCsvRows({ ...fictionalGhgAdoption, reductionTarget: { status: 'not_set' } }))
      .toEqual([['削減目標', 'reduction_target', 'OGT の削減目標', '未設定', '', '', '', expect.stringContaining('登録されていない')]]);
    const { reductionTarget: _omitted, ...before } = fictionalGhgAdoption;
    void _omitted;
    expect(reductionTargetCsvRows(before)[0][3]).toBe('未採用');
  });

  it('GHG の行の後ろに続けて出す', () => {
    const rows = ghgAdoptionCsvRows('report-1', fictionalGhgAdoption);
    expect(rows.at(-1)?.[1]).toBe('reduction_target.report_year.gap');
  });
});
