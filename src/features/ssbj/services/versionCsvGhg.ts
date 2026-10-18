// 保存版の GHG セクション（sections.ghg。T08b の採用値）を社内確認用 CSV の行へ変換する。
// 列は versionCsv.ts の見出し（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）にそろえる。

import type { OgtAdoptedValue, SsbjGhgAdoption } from '../types';
import { isDecimalString } from '../utils/decimal';
import {
  OGT_DATA_QUALITY_LABELS, OGT_SOURCE_LABELS, ogtMethodLabel, ogtValueKey, ogtValueLabel, SCOPE2_BASIS_VIEW_LABELS,
} from '../utils/ogtValue';

const GROUP = 'GHG排出量';

const isValidTotal = (total: OgtAdoptedValue['value']): boolean =>
  !!total && (total.state !== 'answered' || isDecimalString(total.value));

const isValidAdoptedValue = (value: OgtAdoptedValue): boolean =>
  !!value && [1, 2, 3].includes(value.scope) && !!OGT_DATA_QUALITY_LABELS[value.dataQuality] && isValidTotal(value.value) &&
  (value.scope !== 2 || !value.method.basisTotals || Object.values(value.method.basisTotals).every(isValidTotal));

const internalRecord = (value: OgtAdoptedValue): string =>
  [
    `採用方式: ${ogtMethodLabel(value)}`,
    `取得元: ${OGT_SOURCE_LABELS[value.source.aggregate] ?? value.source.aggregate}`,
    value.coverage
      ? `登録済み活動量: 算定済み ${value.coverage.calculatedCount} 件・未算定 ${value.coverage.uncalculatedCount} 件`
      : null,
  ].filter(part => part !== null).join('／');

// 出典が OGT の算定値であることを必ず書く（外部算定値の行と区別するため）。
const SOURCE_NOTE = '出典: OGT 算定値';

const note = (value: OgtAdoptedValue): string => {
  if (value.scope !== 2 || value.method.kind !== 'activity_based' || !('scope2Basis' in value.method)) return SOURCE_NOTE;
  const breakdown = value.method.factorTypeBreakdown;
  return `${SOURCE_NOTE}。` +
    (value.method.basisTotals
      ? '基準の区別のない値（温対法の係数区分による）。基準別の値は別の行'
      : 'ロケーション基準・マーケット基準の区別なし（基準不明）') +
    (breakdown
      ? `。係数区分の内訳: 基礎 ${breakdown.basic}／調整後 ${breakdown.adjusted}／区分なし ${breakdown.unclassified}`
      : '');
};

/**
 * Scope 2 の基準別の行（ロケーション基準・マーケット基準）。基準別の値を取り込む前の保存版には無いので出さない。
 * 未算定は空欄＋「未算定」にし、0 にしない。
 */
const scope2BasisRows = (value: OgtAdoptedValue, internalRecords: boolean): string[][] => {
  if (value.scope !== 2 || !value.method.basisTotals) return [];
  const { locationBased, marketBased, marketContract } = value.method.basisTotals;
  const row = (key: string, label: string, total: typeof locationBased, rowNote: string): string[] => [
    GROUP,
    `scope2.${key}`,
    `Scope 2（${label}）`,
    total.state === 'answered' ? OGT_DATA_QUALITY_LABELS[value.dataQuality] : '未算定',
    total.state === 'answered' ? total.value : '',
    value.unit,
    internalRecords ? internalRecord(value) : '',
    `${SOURCE_NOTE}。${rowNote}`,
  ];
  return [
    row('location_based', SCOPE2_BASIS_VIEW_LABELS.locationBased, locationBased, '公式の標準係数（全国の代替値）で算定'),
    row('market_based', SCOPE2_BASIS_VIEW_LABELS.marketBased, marketBased, marketContract.state === 'answered'
      ? `うち契約したメニューの係数による分 ${marketContract.value}。残りは代替値で補った分`
      : '契約したメニューの係数で算定し、契約が分からない分は代替値で補う'),
  ];
};

/**
 * GHG セクションの行。採用していない（null）版は「未採用」の 1 行にして、欠落と区別する。
 * internalRecords が false なら内部記録の列を空にする（閲覧者の保存版には取得元・件数が無い。versionCsv.ts が列ごと除く）。
 */
export const ghgAdoptionCsvRows = (
  reportId: string,
  ghg: SsbjGhgAdoption | null,
  { internalRecords = true }: { internalRecords?: boolean } = {},
): string[][] => {
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
      internalRecords ? internalRecord(value) : '',
      note(value),
    ]);
    rows.push(...scope2BasisRows(value, internalRecords));
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
