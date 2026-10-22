// 保存版の外部算定値（sections.external_emissions。R2-13）を社内確認用 CSV の行へ変換する。
// 列は versionCsv.ts の見出し（章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記）にそろえる。
// 出典が外部算定値であることを注記に必ず書く。出典の詳細（算定した者・方法・根拠文書・確認者）と内部メモは、
// 根拠文書と同じく 1 項目ずつ別の行の内部記録の列に入れ、開示内容の列には混ぜない（§5）。
// 内部記録を含めない出力（閲覧者。internalRecords: false）では、出典の詳細の行を出さない（保存版からも除いてある）。

import type { SsbjExternalEmissionSnapshot } from '../types';
import {
  externalEmissionGasesLabel,
  externalEmissionLabel,
  isValidExternalEmissionDisclosure,
  isValidExternalEmissionSnapshot,
} from '../utils/externalEmission';

const GROUP = 'GHG排出量（外部算定値）';

/** 外部算定値の行。採用していない版は行を出さない（OGT の行と違い、無いことが通常のため）。 */
export const externalEmissionCsvRows = (
  items: SsbjExternalEmissionSnapshot[],
  { internalRecords = true }: { internalRecords?: boolean } = {},
): string[][] => {
  const isValid = internalRecords ? isValidExternalEmissionSnapshot : isValidExternalEmissionDisclosure;
  if (!Array.isArray(items) || !items.every(isValid)) {
    throw new Error('外部算定値の保存内容が不正です');
  }
  return items.flatMap(item => {
    const note = `出典: 外部算定値（ID: ${item.id}）`;
    const valueRow = [
      GROUP,
      item.id,
      `${externalEmissionLabel(item)}（${externalEmissionGasesLabel(item.gases)}）`,
      '入力済み',
      item.value,
      item.unit,
      '',
      `${note}。期間: ${item.period.startDate}〜${item.period.endDate}`,
    ];
    if (!internalRecords) return [valueRow];
    // 項目を足す前の保存版にはキーが無いことがある。欠落は null と同じく未入力とする。
    const details: [string, string | null | undefined][] = [
      ['算定した者', item.calculatedBy],
      ['算定方法', item.calculationMethod],
      ['根拠文書', item.evidenceTitle ?? item.evidenceId],
      ['確認者', item.confirmedByName ?? item.confirmedByUserId],
      ['確認日時', item.confirmedAt],
      ['内部メモ', item.internalNote],
    ];
    return [
      valueRow,
      ...details.map(([name, value]) => [
        GROUP, item.id, name, value == null ? '未入力' : '入力済み', '', '', value ?? '', note,
      ]),
    ];
  });
};
