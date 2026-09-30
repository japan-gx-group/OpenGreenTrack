// 保存版の GHG セクション（sections.ghg。T08b の採用値）を社内確認用 CSV の行へ変換する。
// 列は versionCsv.ts の見出し（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）にそろえる。

import type { OgtAdoptedValue, SsbjGhgAdoption } from '../types';
import { isDecimalString } from '../utils/decimal';
import { OGT_DATA_QUALITY_LABELS, OGT_SOURCE_LABELS, ogtMethodLabel, ogtValueKey, ogtValueLabel } from '../utils/ogtValue';

const GROUP = 'GHG排出量';

const isValidAdoptedValue = (value: OgtAdoptedValue): boolean =>
  !!value && [1, 2, 3].includes(value.scope) && !!value.value && !!OGT_DATA_QUALITY_LABELS[value.dataQuality] &&
  (value.value.state !== 'answered' || isDecimalString(value.value.value));

const internalRecord = (value: OgtAdoptedValue): string =>
  [
    `採用方式: ${ogtMethodLabel(value)}`,
    `取得元: ${OGT_SOURCE_LABELS[value.source.aggregate] ?? value.source.aggregate}`,
    value.coverage
      ? `登録済み活動量: 算定済み ${value.coverage.calculatedCount} 件・未算定 ${value.coverage.uncalculatedCount} 件`
      : null,
  ].filter(part => part !== null).join('／');

const note = (value: OgtAdoptedValue): string => {
  if (value.scope !== 2 || value.method.kind !== 'activity_based' || !('scope2Basis' in value.method)) return '';
  const breakdown = value.method.factorTypeBreakdown;
  return 'ロケーション基準・マーケット基準の区別なし（基準不明）' +
    (breakdown
      ? `。係数区分の内訳: 基礎 ${breakdown.basic}／調整後 ${breakdown.adjusted}／区分なし ${breakdown.unclassified}`
      : '');
};

/** GHG セクションの行。採用していない（null）版は「未採用」の 1 行にして、欠落と区別する。 */
export const ghgAdoptionCsvRows = (reportId: string, ghg: SsbjGhgAdoption | null): string[][] => {
  if (ghg === null) {
    return [[GROUP, reportId, 'OGT の値', '未採用', '', '', '', 'OGT の候補値をレポートに採用していません']];
  }
  if (!Array.isArray(ghg.values) || !Array.isArray(ghg.supplierReferences) || !ghg.values.every(isValidAdoptedValue)) {
    throw new Error('GHG排出量の保存内容が不正です');
  }

  const rows: string[][] = [[GROUP, reportId, '採用日時', '入力済み', ghg.adoptedAt, '', '', '']];
  for (const value of ghg.values) {
    rows.push([
      GROUP,
      ogtValueKey(value),
      ogtValueLabel(value),
      value.value.state === 'answered' ? OGT_DATA_QUALITY_LABELS[value.dataQuality] : '未算定',
      value.value.state === 'answered' ? value.value.value : '',
      value.unit,
      internalRecord(value),
      note(value),
    ]);
  }
  for (const supplier of ghg.supplierReferences) {
    rows.push([
      `${GROUP}（参考値）`,
      supplier.supplierId,
      `カテゴリ ${supplier.scope3CategoryId}：${supplier.supplierName}`,
      '参考値',
      supplier.emissions,
      supplier.unit,
      '',
      'サプライヤー別の実排出量。Scope 3 の合計には含めない',
    ]);
  }
  return rows;
};
