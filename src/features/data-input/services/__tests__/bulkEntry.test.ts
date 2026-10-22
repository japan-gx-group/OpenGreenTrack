import { describe, expect, it } from 'vitest';
import type { CandidateFactorRow } from '../factorSelectionService';
import type { SavedManualActivityRecord } from '../../types';
import {
  BULK_VALIDATION_MESSAGES,
  buildBulkMonthRows,
  buildBulkPreview,
  buildBulkSaveItems,
  collectBulkEntries,
  type BulkCollectedEntry,
  type BulkMonthRow,
} from '../bulkEntry';
import type { BulkMonthFactor } from '../bulkFactorResolution';
import { ZERO_AMOUNT_PREVIEW_NOTICE } from '../entrySubmission';
import { toYearMonthLabel } from '../targetMonthSelection';

const record = (
  overrides: Partial<SavedManualActivityRecord> & Pick<SavedManualActivityRecord, 'id' | 'periodStart'>,
): SavedManualActivityRecord => ({
  locationId: 'loc-1',
  locationName: '大阪支社',
  energyType: 'electricity',
  amount: 1000,
  unit: 'kWh',
  periodEnd: overrides.periodStart.replace(/-01$/, '-28'),
  note: null,
  createdAt: '2026-01-01T00:00:00Z',
  emissionFactorId: null,
  emissions: null,
  appliedFactorName: null,
  appliedFactorValue: null,
  appliedFactorUnit: null,
  scope3CategoryId: null,
  ideaFactorId: null,
  ideaProductName: null,
  ...overrides,
});

const factor = (
  overrides: Pick<CandidateFactorRow, 'id' | 'name' | 'factorValue'> & Partial<CandidateFactorRow>,
): CandidateFactorRow => ({
  organizationId: null,
  energyType: 'electricity',
  scope: 'scope2',
  unit: 't-CO2/kWh',
  applicableYear: 2026,
  regionName: '全国',
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: '2026-04-01',
  effectiveTo: '2027-03-31',
  providerName: null,
  providerNumber: null,
  menuName: null,
  factorType: 'adjusted',
  source: 'moe',
  sourceDocumentName: null,
  ...overrides,
});

describe('buildBulkMonthRows', () => {
  const months = ['2026-04', '2026-05', '2026-06'];

  it('未来月・登録済み・単位不一致を行の状態に写す', () => {
    const existingSameUnit = record({ id: 'r1', periodStart: '2026-04-01' });
    const existingOtherUnit = record({ id: 'r2', periodStart: '2026-05-01', unit: 'MWh' });
    const rows = buildBulkMonthRows({
      months,
      history: [existingSameUnit, existingOtherUnit],
      target: { kind: 'scope12', locationId: 'loc-1', energyType: 'electricity' },
      maxTargetMonth: '2026-05',
      currentUnit: 'kWh',
    });
    expect(rows.map((row) => row.label)).toEqual(['2026年4月', '2026年5月', '2026年6月']);
    expect(rows[0]).toMatchObject({ existing: existingSameUnit, isFuture: false, canOverwrite: true });
    // 単位が異なる取込データは上書き不可（グリッドの単位で上書きすると意味が変わる）。
    expect(rows[1]).toMatchObject({ existing: existingOtherUnit, canOverwrite: false });
    expect(rows[2]).toMatchObject({ existing: null, isFuture: true, canOverwrite: false });
  });

  it('拠点・種別が違うレコードは照合しない', () => {
    const rows = buildBulkMonthRows({
      months: ['2026-04'],
      history: [
        record({ id: 'r1', periodStart: '2026-04-01', locationId: 'loc-2' }),
        record({ id: 'r2', periodStart: '2026-04-01', energyType: 'city_gas' }),
      ],
      target: { kind: 'scope12', locationId: 'loc-1', energyType: 'electricity' },
      maxTargetMonth: '2026-07',
      currentUnit: 'kWh',
    });
    expect(rows[0].existing).toBeNull();
  });

  it('Scope3積上げはカテゴリ×IDEA製品まで一致した月だけ登録済みにする', () => {
    const matched = record({
      id: 'r1',
      periodStart: '2026-04-01',
      energyType: 'scope3_activity',
      scope3CategoryId: 1,
      ideaFactorId: 'idea-1',
      unit: 'kg',
    });
    const otherProduct = record({
      id: 'r2',
      periodStart: '2026-05-01',
      energyType: 'scope3_activity',
      scope3CategoryId: 1,
      ideaFactorId: 'idea-2',
      unit: 'kg',
    });
    const rows = buildBulkMonthRows({
      months: ['2026-04', '2026-05'],
      history: [matched, otherProduct],
      target: { kind: 'scope3', locationId: 'loc-1', scope3CategoryId: 1, ideaFactorId: 'idea-1' },
      maxTargetMonth: '2026-07',
      currentUnit: 'kg',
    });
    expect(rows[0].existing).toBe(matched);
    expect(rows[1].existing).toBeNull();
  });

  it('照合キーが未確定（target=null）なら既存照合を行わない', () => {
    const rows = buildBulkMonthRows({
      months: ['2026-04'],
      history: [record({ id: 'r1', periodStart: '2026-04-01' })],
      target: null,
      maxTargetMonth: '2026-07',
      currentUnit: null,
    });
    expect(rows[0].existing).toBeNull();
  });
});

describe('collectBulkEntries', () => {
  const row = (overrides: Partial<BulkMonthRow> & Pick<BulkMonthRow, 'month'>): BulkMonthRow => ({
    label: toYearMonthLabel(overrides.month),
    isFuture: false,
    existing: null,
    canOverwrite: false,
    ...overrides,
  });

  it('空欄の月はスキップし、入力のある月だけ集める', () => {
    const { entries, error } = collectBulkEntries({
      rows: [row({ month: '2026-04' }), row({ month: '2026-05' }), row({ month: '2026-06', isFuture: true })],
      amounts: { '2026-04': '100', '2026-06': '999' },
      overwriteEnabled: {},
    });
    expect(error).toBeNull();
    // 未来月は入力値が残っていても対象にしない。
    expect(entries).toEqual([
      { month: '2026-04', label: '2026年4月', amount: 100, action: 'create', existing: null },
    ]);
  });

  it('不正な活動量は月ラベル付きの最初のエラーを返す（単月入力と同じ検証）', () => {
    const { error } = collectBulkEntries({
      rows: [row({ month: '2026-04' }), row({ month: '2026-05' })],
      amounts: { '2026-04': '100', '2026-05': '1.2345' },
      overwriteEnabled: {},
    });
    expect(error).toBe('2026年5月: 活動量は小数第3位までで入力してください。');
    expect(
      collectBulkEntries({
        rows: [row({ month: '2026-04' })],
        amounts: { '2026-04': 'abc' },
        overwriteEnabled: {},
      }).error,
    ).toBe('2026年4月: 活動量は0以上の半角数字で入力してください。');
  });

  it('活動量 0 は実績ゼロの記録として対象に含める', () => {
    const { entries, error } = collectBulkEntries({
      rows: [row({ month: '2026-04' })],
      amounts: { '2026-04': '0' },
      overwriteEnabled: {},
    });
    expect(error).toBeNull();
    expect(entries).toEqual([
      { month: '2026-04', label: '2026年4月', amount: 0, action: 'create', existing: null },
    ]);
  });

  it('登録済みの月は上書きを選んだときだけ対象にし、入力必須にする', () => {
    const existing = record({ id: 'r1', periodStart: '2026-04-01', note: '既存メモ' });
    const rows = [
      row({ month: '2026-04', existing, canOverwrite: true }),
      row({ month: '2026-05', existing: record({ id: 'r2', periodStart: '2026-05-01' }), canOverwrite: true }),
    ];
    // 上書き未選択の月は入力値が残っていても対象外。
    expect(
      collectBulkEntries({ rows, amounts: { '2026-04': '100' }, overwriteEnabled: {} }).error,
    ).toBe(BULK_VALIDATION_MESSAGES.noEntries);
    // 上書きを選んだのに空欄ならエラー。
    expect(
      collectBulkEntries({ rows, amounts: {}, overwriteEnabled: { '2026-04': true } }).error,
    ).toBe(`2026年4月: ${BULK_VALIDATION_MESSAGES.overwriteEmpty}`);
    const { entries, error } = collectBulkEntries({
      rows,
      amounts: { '2026-04': '200' },
      overwriteEnabled: { '2026-04': true },
    });
    expect(error).toBeNull();
    expect(entries).toEqual([
      { month: '2026-04', label: '2026年4月', amount: 200, action: 'overwrite', existing },
    ]);
  });
});

describe('buildBulkSaveItems', () => {
  const entries: BulkCollectedEntry[] = [
    { month: '2026-04', label: '2026年4月', amount: 100, action: 'create', existing: null },
    {
      month: '2026-05',
      label: '2026年5月',
      amount: 200,
      action: 'overwrite',
      existing: record({ id: 'r5', periodStart: '2026-05-01', note: '既存メモ' }),
    },
  ];

  it('Scope1/2: 月ごとの係数IDを使い、上書きは既存の備考を保持する', () => {
    const items = buildBulkSaveItems({
      category: { kind: 'energy', energyType: 'electricity' },
      locationId: 'loc-1',
      entries,
      unit: 'kWh',
      note: '一括入力の備考',
      factorIdByMonth: new Map([
        ['2026-04', 'factor-a'],
        ['2026-05', 'factor-b'],
      ]),
      ideaFactorId: null,
    });
    expect(items).not.toBeNull();
    expect(items![0]).toEqual({
      action: 'create',
      month: '2026-04',
      label: '2026年4月',
      entry: {
        kind: 'scope12',
        input: {
          locationId: 'loc-1',
          energyType: 'electricity',
          amount: 100,
          unit: 'kWh',
          periodStart: '2026-04-01',
          periodEnd: '2026-04-30',
          note: '一括入力の備考',
          emissionFactorId: 'factor-a',
        },
      },
    });
    expect(items![1]).toMatchObject({
      action: 'overwrite',
      recordId: 'r5',
      entry: { kind: 'scope12', input: { amount: 200, emissionFactorId: 'factor-b', note: '既存メモ' } },
    });
  });

  it('Scope3積上げ: 選択製品のIDで組み立てる（無ければ null = 不整合）', () => {
    const items = buildBulkSaveItems({
      category: { kind: 'scope3', categoryId: 1 },
      locationId: 'loc-1',
      entries: entries.slice(0, 1),
      unit: 'kg',
      note: '',
      factorIdByMonth: new Map(),
      ideaFactorId: 'idea-1',
    });
    expect(items![0].entry).toEqual({
      kind: 'scope3',
      input: {
        locationId: 'loc-1',
        scope3CategoryId: 1,
        ideaFactorId: 'idea-1',
        amount: 100,
        unit: 'kg',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        note: null,
      },
    });
    expect(
      buildBulkSaveItems({
        category: { kind: 'scope3', categoryId: 1 },
        locationId: 'loc-1',
        entries: entries.slice(0, 1),
        unit: 'kg',
        note: '',
        factorIdByMonth: new Map(),
        ideaFactorId: null,
      }),
    ).toBeNull();
  });
});

describe('buildBulkPreview', () => {
  const resolved = (
    factorRow: CandidateFactorRow,
    flags: Partial<{ fellBack: boolean; provisional: boolean; providerFellBack: boolean }> = {},
  ): BulkMonthFactor => ({
    factorIdToSave: factorRow.id,
    applied: {
      status: 'resolved',
      factor: factorRow,
      fellBack: flags.fellBack ?? false,
      remapped: false,
      ambiguous: false,
      provisional: flags.provisional ?? false,
    },
    providerFellBack: flags.providerFellBack ?? false,
  });

  it('月ごとの推定排出量と合計を算定エンジンと同じ丸めで出す', () => {
    const national = factor({ id: 'national', name: '電気（代替値・全国）', factorValue: 0.0005 });
    const preview = buildBulkPreview({
      entries: [
        { month: '2026-04', label: '2026年4月', amount: 10000, action: 'create', existing: null },
        { month: '2026-05', label: '2026年5月', amount: 20000, action: 'overwrite', existing: null },
      ],
      unit: 'kWh',
      isIdea: false,
      factorByMonth: new Map([
        ['2026-04', resolved(national)],
        ['2026-05', resolved(national, { fellBack: true })],
      ]),
      productDetail: null,
      fiscalYears: [],
    });
    expect(preview.monthRows[0]).toMatchObject({
      label: '2026年4月',
      actionLabel: '新規登録',
      amountText: '10,000 kWh',
      emissionsText: '5',
      warning: null,
    });
    expect(preview.monthRows[1]).toMatchObject({
      actionLabel: '上書き',
      emissionsText: '10',
      warning: '選択中の係数はこの月には適用できないため、自動選択された係数で算定されます。',
    });
    expect(preview.totalEmissionsText).toBe('15 t-CO2e');
    expect(preview.createCount).toBe(1);
    expect(preview.overwriteCount).toBe(1);
  });

  it('係数なし・単位換算不可の月は未算定（—）とし合計も出さない', () => {
    const mismatch = factor({ id: 'f-m3', name: 'ガス係数', factorValue: 2, unit: 't-CO2/m3' });
    const preview = buildBulkPreview({
      entries: [
        { month: '2026-04', label: '2026年4月', amount: 100, action: 'create', existing: null },
        { month: '2026-05', label: '2026年5月', amount: 100, action: 'create', existing: null },
      ],
      unit: 'kWh',
      isIdea: false,
      factorByMonth: new Map([
        [
          '2026-04',
          {
            factorIdToSave: null,
            applied: {
              status: 'resolved',
              factor: null,
              fellBack: false,
              remapped: false,
              ambiguous: true,
              provisional: false,
            },
            providerFellBack: false,
          } satisfies BulkMonthFactor,
        ],
        ['2026-05', resolved(mismatch)],
      ]),
      productDetail: null,
      fiscalYears: [],
    });
    expect(preview.monthRows[0].emissionsText).toBe('—');
    expect(preview.monthRows[0].warning).toContain('同順位の候補が複数ある');
    expect(preview.monthRows[1].emissionsText).toBe('—');
    expect(preview.monthRows[1].warning).toContain('単位を係数の単位へ換算できない');
    expect(preview.totalEmissionsText).toBe('—');
  });

  it('事業者の係数行が無い月は代替値へ落ちることを知らせ、活動量 0 の月は実績ゼロの確認表示を添える', () => {
    const national = factor({ id: 'national', name: '電気（代替値・全国）', factorValue: 0.0005 });
    const preview = buildBulkPreview({
      entries: [
        { month: '2026-04', label: '2026年4月', amount: 10000, action: 'create', existing: null },
        { month: '2026-05', label: '2026年5月', amount: 0, action: 'create', existing: null },
      ],
      unit: 'kWh',
      isIdea: false,
      factorByMonth: new Map([
        ['2026-04', resolved(national, { providerFellBack: true })],
        ['2026-05', resolved(national)],
      ]),
      productDetail: null,
      fiscalYears: [],
    });
    // 保存する係数 ID 自体が代替値になるため applied.fellBack では分からず、事業者のフォールバックを別に知らせる。
    expect(preview.monthRows[0].warning).toBe(
      '選択中の供給事業者の係数はこの月の年度には登録されていないため、代替値（自動選択された係数）で算定されます。',
    );
    expect(preview.monthRows[1]).toMatchObject({
      amountText: '0 kWh',
      emissionsText: '0',
      warning: ZERO_AMOUNT_PREVIEW_NOTICE,
    });
    expect(preview.totalEmissionsText).toBe('5 t-CO2e');
  });
});
