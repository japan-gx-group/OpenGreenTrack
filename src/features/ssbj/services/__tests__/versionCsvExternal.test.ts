import { describe, expect, it } from 'vitest';
import { fictionalExternalEmissions } from '../../__fixtures__/fictionalReport';
import { externalEmissionCsvRows } from '../versionCsvExternal';

// 外部算定値の CSV の行: 出典（外部算定値）を注記に必ず書き、出典の詳細と内部メモは別の行の内部記録の列に入れる。

describe('externalEmissionCsvRows', () => {
  const rows = externalEmissionCsvRows(fictionalExternalEmissions);
  const [item] = fictionalExternalEmissions;

  it('値の行は、区分と対象ガス・排出量・単位を出し、注記に出典を書く（開示内容の列に内部記録を混ぜない）', () => {
    expect(rows[0]).toEqual([
      'GHG排出量（外部算定値）', item.id, 'Scope 1（CH4・N2O）', '入力済み', '1.250', 't-CO2e', '',
      `出典: 外部算定値（ID: ${item.id}）。期間: 2024-04-01〜2025-03-31`,
    ]);
  });

  it('出典の詳細と内部メモは、1 項目ずつ内部記録の列に出す', () => {
    const details = rows.slice(1).map(row => [row[2], row[4], row[6]]);
    expect(details).toEqual([
      ['算定した者', '', item.calculatedBy],
      ['算定方法', '', item.calculationMethod],
      ['根拠文書', '', item.evidenceTitle],
      ['確認者', '', item.confirmedByName],
      ['確認日時', '', item.confirmedAt],
      ['内部メモ', '', item.internalNote],
    ]);
    expect(rows.slice(1).every(row => row[7].startsWith('出典: 外部算定値'))).toBe(true);
  });

  it('形が崩れた保存内容は出力せずエラーにする', () => {
    expect(() => externalEmissionCsvRows([{ ...item, value: '1,250' }])).toThrow('外部算定値の保存内容が不正です');
  });
});
