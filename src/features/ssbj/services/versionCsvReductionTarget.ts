// 保存版の GHG セクションに含まれる削減目標（sections.ghg.reductionTarget。R2-32）を社内確認用 CSV の行へ変換する。
// 列は versionCsv.ts の見出し（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）にそろえる。
// 目標未設定・未算定は空欄＋状態の名前にし、0 にしない。

import type { SsbjDecimalString, SsbjFieldValue, SsbjGhgAdoption } from '../types';
import { BASE_YEAR_IN_PROGRESS_NOTE, reductionTargetGap } from '../utils/reductionTarget';

const GROUP = '削減目標';
const SOURCE_NOTE = '出典: OGT の削減目標（採用した時点の値）';

const emissionsCells = (value: SsbjFieldValue<SsbjDecimalString>, unit: string): [string, string, string] =>
  value.state === 'answered' ? ['入力済み', value.value, unit] : ['未算定', '', unit];

export const reductionTargetCsvRows = (ghg: SsbjGhgAdoption): string[][] => {
  const target = ghg.reductionTarget;
  if (target === undefined) {
    return [[GROUP, 'reduction_target', 'OGT の削減目標', '未採用', '', '', '',
      '削減目標を一緒に採用するようになる前に採用した値。採用し直すと削減目標も入る']];
  }
  if (target.status === 'not_set') {
    return [[GROUP, 'reduction_target', 'OGT の削減目標', '未設定', '', '', '', `${SOURCE_NOTE}。OGT に削減目標が登録されていない`]];
  }

  const { baseFiscalYear, reportYear, unit } = target;
  const baseNote = target.baseYearEnded ? SOURCE_NOTE : `${SOURCE_NOTE}。${BASE_YEAR_IN_PROGRESS_NOTE}`;
  const rows: string[][] = [
    [GROUP, 'reduction_target.base_year', '基準年度', '入力済み',
      `${baseFiscalYear.label}（${baseFiscalYear.startDate}〜${baseFiscalYear.endDate}）`, '', '', baseNote],
    [GROUP, 'reduction_target.base_year_emissions', '基準年度の排出量（Scope 1・2・3 の合計）',
      ...emissionsCells(target.baseYearEmissions, unit), '', baseNote],
  ];
  for (const year of target.targetYears) {
    rows.push(
      [GROUP, `reduction_target.${year.targetYear}.reduction_percent`, `${year.targetYear} 年度の削減率（基準年度比）`,
        '入力済み', year.reductionPercent, '%', '', SOURCE_NOTE],
      [GROUP, `reduction_target.${year.targetYear}.target_emissions`, `${year.targetYear} 年度の目標排出量`,
        ...emissionsCells(year.targetEmissions, unit), '', `${SOURCE_NOTE}。基準年度の排出量 ×（1 − 削減率 / 100）`],
    );
  }

  const label = `レポートの年度（${reportYear.targetYear} 年度）`;
  const gap = reductionTargetGap(target);
  rows.push(
    reportYear.reductionPercent.state === 'answered'
      ? [GROUP, 'reduction_target.report_year.reduction_percent', `${label}の削減率`, '入力済み',
        reportYear.reductionPercent.value, '%', '', SOURCE_NOTE]
      : [GROUP, 'reduction_target.report_year.reduction_percent', `${label}の削減率`, '未設定', '', '%', '',
        `${SOURCE_NOTE}。この年度の削減率は登録されていない（0% ではない）`],
    [GROUP, 'reduction_target.report_year.target_emissions', `${label}の目標排出量`,
      ...(reportYear.reductionPercent.state === 'answered'
        ? emissionsCells(reportYear.targetEmissions, unit)
        : ['未設定', '', unit] as [string, string, string]), '', SOURCE_NOTE],
    [GROUP, 'reduction_target.report_year.actual_emissions', `${label}の実績排出量（Scope 1・2・3 の合計）`,
      ...emissionsCells(reportYear.actualEmissions, unit), '', SOURCE_NOTE],
    [GROUP, 'reduction_target.report_year.gap', `${label}の実績と目標の差（実績 − 目標）`,
      gap.state === 'answered' ? '入力済み' : '算定できない', gap.state === 'answered' ? gap.value : '', unit, '',
      gap.state === 'answered' ? `${SOURCE_NOTE}。負の値は目標を下回っている` : '目標未設定か、排出量が未算定のため差を出せない'],
  );
  return rows;
};
