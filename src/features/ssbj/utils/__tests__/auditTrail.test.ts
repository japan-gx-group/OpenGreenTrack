import { describe, expect, it } from 'vitest';
import { fictionalGhgAdoption, fictionalSnapshot } from '../../__fixtures__/fictionalReport';
import type { SsbjAuditTrailDetails, SsbjTrailDetail } from '../../types';
import {
  decimalStringsEqual,
  reconcileTrail,
  roundDecimalString,
  sumDecimalStrings,
  toSsbjAuditTrailDetails,
  trailDetailRows,
  trailEvidenceRows,
  trailFactorRows,
  trailSummaryRows,
  type TrailExportContext,
} from '../auditTrail';

const detail = (overrides: Partial<SsbjTrailDetail>): SsbjTrailDetail => ({
  activityRecordId: 'record-1',
  locationName: '本社',
  sourceType: 'manual',
  energyType: 'electricity',
  amount: '1000.000',
  unit: 'kWh',
  periodStart: '2024-04-01',
  periodEnd: '2024-04-30',
  note: '検針票の再発行分',
  scope: 'scope1',
  categoryId: null,
  emissions: '0',
  emissionFactorId: 'factor-1',
  appliedFactorName: '電気（全国平均）',
  appliedFactorValue: '0.000434',
  appliedFactorUnit: 'kg-CO2e/kWh',
  calculatedAt: '2025-05-01T00:00:00+00:00',
  basis: [],
  evidenceFiles: [],
  ...overrides,
});

const basis = (location: string, market: string) => [
  { basis: 'location_based' as const, evidence: 'grid_average', emissions: location, emissionFactorId: 'factor-1',
    appliedFactorName: '全国平均', appliedFactorValue: '0.000434', appliedFactorUnit: 'kg-CO2e/kWh' },
  { basis: 'market_based' as const, evidence: 'contract_menu', emissions: market, emissionFactorId: 'factor-2',
    appliedFactorName: 'メニュー A', appliedFactorValue: '0.000450', appliedFactorUnit: 'kg-CO2e/kWh' },
];

/** 架空のレポートの開示値（fictionalGhgAdoption）と合計が一致する明細（明細は 6 桁、合計は 3 桁に丸める）。 */
const matchingTrail: SsbjAuditTrailDetails = {
  details: [
    detail({ activityRecordId: 'r-s1-a', scope: 'scope1', emissions: '500.123400', energyType: 'fuel_diesel' }),
    detail({ activityRecordId: 'r-s1-b', scope: 'scope1', emissions: '312.221600', energyType: 'fuel_gasoline' }),
    detail({ activityRecordId: 'r-s2-a', scope: 'scope2', emissions: '600.000400', basis: basis('575.000200', '586.200000'),
      evidenceFiles: [{ id: 'file-1', fileName: '電気料金_4月.pdf', sha256: 'a'.repeat(64) }] }),
    detail({ activityRecordId: 'r-s2-b', scope: 'scope2', emissions: '565.749600', basis: basis('574.999800', '586.200000'),
      evidenceFiles: [{ id: 'file-1', fileName: '電気料金_4月.pdf', sha256: 'a'.repeat(64) }] }),
    detail({ activityRecordId: 'r-s3-a', scope: 'scope3', categoryId: 6, emissions: '20.120000', energyType: 'business_travel' }),
    detail({ activityRecordId: 'r-s3-b', scope: 'scope3', categoryId: 6, emissions: '15.000000', energyType: 'business_travel' }),
  ],
  scope3Direct: [],
  factors: [{
    id: 'factor-1', name: '電気（全国平均）', energyType: 'electricity', scope: 'scope2', factorValue: '0.000434',
    unit: 'kg-CO2e/kWh', applicableYear: 2024, regionName: '全国', source: 'moe', status: 'active', isCustom: false,
    factorType: 'basic', effectiveFrom: null, effectiveTo: null, sourceDocumentName: '算定・報告・公表制度の係数', sourceUrl: null,
    providerName: null, menuName: null,
  }],
};

const context = (internalRecords = false): TrailExportContext => ({
  version: { id: 'version-1', versionNumber: 2, snapshot: fictionalSnapshot },
  isApprovedVersion: true,
  generatedAt: '2025-06-10T00:00:00.000Z',
  generatedBy: '架空 太郎',
  internalRecords,
});

describe('decimal helpers', () => {
  it('合計は丸めず桁落ちしない。丸めは四捨五入（負は 0 から遠い方へ。PostgreSQL の numeric と同じ）', () => {
    expect(sumDecimalStrings(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimalStrings(['12345678901234.123456', '0.000001'])).toBe('12345678901234.123457');
    expect(sumDecimalStrings([])).toBe('0');
    expect(roundDecimalString('812.3455', 3)).toBe('812.346');
    expect(roundDecimalString('812.3454999', 3)).toBe('812.345');
    expect(roundDecimalString('-0.0005', 3)).toBe('-0.001');
    expect(roundDecimalString('35.12', 3)).toBe('35.120');
    expect(decimalStringsEqual('35.120', '35.12')).toBe(true);
    expect(decimalStringsEqual('0', '0.000')).toBe(true);
    expect(decimalStringsEqual('1', '1.001')).toBe(false);
  });
});

describe('reconcileTrail（照合）', () => {
  it('出力する明細の合計が、保存版の開示値（Scope 1・2・基準別・カテゴリ）と一致する', () => {
    const rows = reconcileTrail(fictionalGhgAdoption, matchingTrail);
    const byKey = new Map(rows.map(row => [row.key, row]));
    expect(byKey.get('scope1')).toMatchObject({ recomputed: '812.345', status: 'match', detailCount: 2 });
    expect(byKey.get('scope2')).toMatchObject({ recomputed: '1165.750', status: 'match', detailCount: 2 });
    expect(byKey.get('scope2.location_based')).toMatchObject({ recomputed: '1150.000', status: 'match' });
    expect(byKey.get('scope2.market_based')).toMatchObject({ recomputed: '1172.400', status: 'match' });
    expect(byKey.get('scope3.category6')).toMatchObject({ recomputed: '35.120000', status: 'match', detailCount: 2 });
    // 明細の無いカテゴリは 0 として比べる。未算定の開示値は照合しない（0 にしない）。
    expect(byKey.get('scope3.category1')).toMatchObject({ recomputed: '0', status: 'match', detailCount: 0 });
    expect(byKey.get('scope3.category4')).toMatchObject({ status: 'not_calculated' });
    expect(rows.filter(row => row.status === 'mismatch')).toEqual([]);
  });

  it('保存版を作った後に OGT の算定が変わり、明細の合計が開示値と違えば「不一致」にする（黙って合わせない）', () => {
    const changed = { ...matchingTrail, details: [...matchingTrail.details, detail({ activityRecordId: 'r-new', scope: 'scope1', emissions: '0.001' })] };
    expect(reconcileTrail(fictionalGhgAdoption, changed).find(row => row.key === 'scope1'))
      .toMatchObject({ recomputed: '812.346', status: 'mismatch' });
  });

  it('基準別の明細が無い活動量があれば、基準別は計算せず不一致にする', () => {
    const partial = { ...matchingTrail, details: matchingTrail.details.map(item => item.activityRecordId === 'r-s2-b' ? { ...item, basis: [] } : item) };
    expect(reconcileTrail(fictionalGhgAdoption, partial).find(row => row.key === 'scope2.location_based'))
      .toMatchObject({ recomputed: null, status: 'mismatch' });
  });

  it('Scope 3 の直接入力のカテゴリは、直接入力の値で照合する', () => {
    const direct = {
      ...matchingTrail,
      details: matchingTrail.details.filter(item => item.scope !== 'scope3'),
      scope3Direct: [{ id: 'direct-1', categoryId: 6, emissions: '35.120', periodStart: null, periodEnd: null, dataSourceNote: '委託先の報告', updatedAt: '2025-05-01T00:00:00+00:00' }],
    };
    expect(reconcileTrail(fictionalGhgAdoption, direct).find(row => row.key === 'scope3.category6'))
      .toMatchObject({ status: 'match', detailCount: 1 });
  });

  it('OGT の値を採用していない版は照合しない', () => {
    expect(reconcileTrail(null, matchingTrail)).toEqual([]);
    expect(reconcileTrail(undefined, matchingTrail)).toEqual([]);
  });
});

describe('シートの行', () => {
  it('サマリに版・承認・出力した人・照合の結果を出す', () => {
    const { rows, headerRowIndex } = trailSummaryRows(context(), reconcileTrail(fictionalGhgAdoption, matchingTrail));
    expect(rows).toContainEqual(['保存版', '版 2（承認した版）', 'version-1']);
    expect(rows).toContainEqual(['出力した人', '架空 太郎']);
    expect(rows).toContainEqual(['照合の結果', 'すべて一致']);
    expect(rows[headerRowIndex][0]).toBe('開示値の区分');
    expect(rows).toContainEqual(['Scope 1', 'scope1', '812.345', '812.345', 't-CO2e', '一致', '2']);
  });

  it('内部メモ・内部記録は既定では出さない（活動量のメモ・根拠文書の資料名・外部算定値の出典）', () => {
    const text = JSON.stringify([
      trailDetailRows(matchingTrail, false),
      trailEvidenceRows(fictionalSnapshot, matchingTrail, false).rows,
      trailSummaryRows(context(false), []).rows,
    ]);
    expect(text).not.toContain('検針票の再発行分');
    for (const evidence of fictionalSnapshot.sections.evidence ?? []) expect(text).not.toContain(evidence.documentTitle);
    for (const item of fictionalSnapshot.sections.external_emissions ?? []) expect(text).not.toContain(item.calculatedBy);
  });

  it('内部メモ・内部記録を含めると、活動量のメモ・根拠文書の資料名・外部算定値の出典を出す', () => {
    const text = JSON.stringify([
      trailDetailRows(matchingTrail, true),
      trailEvidenceRows(fictionalSnapshot, matchingTrail, true).rows,
      trailSummaryRows(context(true), []).rows,
    ]);
    expect(text).toContain('検針票の再発行分');
    for (const evidence of fictionalSnapshot.sections.evidence ?? []) expect(text).toContain(evidence.documentTitle);
    for (const item of fictionalSnapshot.sections.external_emissions ?? []) expect(text).toContain(item.calculatedBy);
  });

  it('明細は開示値の区分・活動量・適用した係数・排出量・基準別・帳票を 1 行に出す。列数は見出しとそろえる', () => {
    const rows = trailDetailRows(matchingTrail, false);
    const scope2 = rows.find(row => row[2] === 'r-s2-a')!;
    expect(scope2.slice(0, 2)).toEqual(['Scope 2', 'scope2']);
    expect(scope2).toContain('600.000400');
    expect(scope2).toContain('575.000200');
    expect(scope2).toContain('電気料金_4月.pdf');
    expect(rows.find(row => row[2] === 'r-s3-a')?.slice(0, 2)).toEqual([expect.stringContaining('カテゴリ 6'), 'scope3.category6']);
    expect(rows.every(row => row.length === rows[0].length)).toBe(true);
  });

  it('係数は使った件数とともに出し、帳票は活動量との対応を出す', () => {
    expect(trailFactorRows(matchingTrail)[1].at(-1)).toBe('6');
    const { rows } = trailEvidenceRows(fictionalSnapshot, matchingTrail, false);
    expect(rows).toContainEqual(['file-1', '電気料金_4月.pdf', 'a'.repeat(64), '2', 'r-s2-a、r-s2-b']);
  });
});

describe('toSsbjAuditTrailDetails', () => {
  it('数値が十進文字列でなければ例外にする（0 にして出力しない）', () => {
    expect(toSsbjAuditTrailDetails(matchingTrail)).toBe(matchingTrail);
    expect(() => toSsbjAuditTrailDetails({ ...matchingTrail, details: [{ ...matchingTrail.details[0], emissions: 1 }] })).toThrow();
    expect(() => toSsbjAuditTrailDetails(null)).toThrow();
  });
});
