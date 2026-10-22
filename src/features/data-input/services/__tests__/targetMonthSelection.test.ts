import { describe, expect, it } from 'vitest';
import {
  OUT_OF_RANGE_YEAR_VALUE,
  buildTargetMonthDropdown,
  listSelectableFiscalYears,
  listYearMonthsInRange,
  nextTargetMonthAfterSave,
  targetMonthForYearSwitch,
  toYearMonthLabel,
} from '../targetMonthSelection';

const FY2024 = { id: 'fy2024', label: '2024年度', startDate: '2024-04-01', endDate: '2025-03-31' };
const FY2025 = { id: 'fy2025', label: '2025年度', startDate: '2025-04-01', endDate: '2026-03-31' };
const FY2023 = { id: 'fy2023', label: '2023年度', startDate: '2023-04-01', endDate: '2024-03-31' };

describe('toYearMonthLabel', () => {
  it('YYYY-MM を「2026年3月」形式にする（月の先頭ゼロは落とす）', () => {
    expect(toYearMonthLabel('2026-03')).toBe('2026年3月');
    expect(toYearMonthLabel('2024-11')).toBe('2024年11月');
  });
});

describe('listYearMonthsInRange', () => {
  it('期間に含まれる月を年またぎ込みで古い順に列挙する', () => {
    expect(listYearMonthsInRange('2024-04-01', '2025-03-31')).toEqual([
      '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09',
      '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03',
    ]);
  });

  it('開始が終了より後なら空を返す', () => {
    expect(listYearMonthsInRange('2025-04-01', '2024-03-31')).toEqual([]);
  });

  it('異常に長い期間でも上限で打ち切る（UI が固まらない）', () => {
    expect(listYearMonthsInRange('2000-01-01', '2100-12-31')).toHaveLength(24);
  });
});

describe('buildTargetMonthDropdown', () => {
  it('対象年月が属する年度を選択し、その年度の全月を出して未来月だけ無効にする', () => {
    const model = buildTargetMonthDropdown({
      fiscalYears: [FY2025, FY2024],
      targetMonth: '2025-01',
      maxTargetMonth: '2025-01',
    });

    // FY2025 は全月が未来のため年度の選択肢に出ない。
    expect(model.yearOptions).toEqual([{ value: 'fy2024', label: '2024年度' }]);
    expect(model.selectedYearValue).toBe('fy2024');
    expect(model.monthOptions).toHaveLength(12);
    expect(model.monthOptions[0]).toEqual({ value: '2024-04', label: '2024年4月', disabled: false });
    expect(
      model.monthOptions.filter((option) => option.disabled).map((option) => option.value),
    ).toEqual(['2025-02', '2025-03']);
  });

  it('編集中の未来月（allowedFutureMonth）は選択可にし、その年度も選択肢に出す', () => {
    const model = buildTargetMonthDropdown({
      fiscalYears: [FY2025, FY2024],
      targetMonth: '2025-06',
      maxTargetMonth: '2025-01',
      allowedFutureMonth: '2025-06',
    });

    expect(model.yearOptions.map((option) => option.value)).toEqual(['fy2025', 'fy2024']);
    expect(model.selectedYearValue).toBe('fy2025');
    const june = model.monthOptions.find((option) => option.value === '2025-06');
    expect(june?.disabled).toBe(false);
    // 同じ年度の他の未来月は選べないまま。
    expect(model.monthOptions.find((option) => option.value === '2025-07')?.disabled).toBe(true);
  });

  it('どの年度にも属さない年月は「算定期間外」の合成行で表示を保つ', () => {
    const model = buildTargetMonthDropdown({
      fiscalYears: [FY2024],
      targetMonth: '2019-05',
      maxTargetMonth: '2025-01',
    });

    expect(model.selectedYearValue).toBe(OUT_OF_RANGE_YEAR_VALUE);
    expect(model.yearOptions).toEqual([
      { value: 'fy2024', label: '2024年度' },
      { value: OUT_OF_RANGE_YEAR_VALUE, label: '算定期間外' },
    ]);
    expect(model.monthOptions).toEqual([
      { value: '2019-05', label: '2019年5月（算定期間外）', disabled: false },
    ]);
  });

  it('年度マスタが空でも対象年月の合成行を返す（取得中の表示用）', () => {
    const model = buildTargetMonthDropdown({
      fiscalYears: [],
      targetMonth: '2025-01',
      maxTargetMonth: '2025-01',
    });

    expect(model.selectedYearValue).toBe(OUT_OF_RANGE_YEAR_VALUE);
    expect(model.monthOptions.map((option) => option.value)).toEqual(['2025-01']);
  });
});

describe('targetMonthForYearSwitch', () => {
  it('同じ月を保ったまま切替先の年度の年月を返す', () => {
    expect(
      targetMonthForYearSwitch({
        fiscalYear: FY2023,
        currentTargetMonth: '2025-01',
        maxTargetMonth: '2025-01',
      }),
    ).toBe('2024-01');
  });

  it('同じ月が切替先で未来月なら、切替先で選べる最も新しい月へ倒す', () => {
    // FY2024 で 3月（2025-03）は当月 2025-01 より未来 → 2025-01 へ。
    expect(
      targetMonthForYearSwitch({
        fiscalYear: FY2024,
        currentTargetMonth: '2024-03',
        maxTargetMonth: '2025-01',
      }),
    ).toBe('2025-01');
  });

  it('選べる月が無い年度は null（切替しない）', () => {
    expect(
      targetMonthForYearSwitch({
        fiscalYear: FY2025,
        currentTargetMonth: '2025-01',
        maxTargetMonth: '2025-01',
      }),
    ).toBeNull();
  });
});

describe('listSelectableFiscalYears', () => {
  it('選べる月を 1 つ以上持つ年度だけを並びのまま残す（全月が未来の年度は落とす）', () => {
    expect(listSelectableFiscalYears([FY2025, FY2024, FY2023], { maxTargetMonth: '2025-01' })).toEqual([
      FY2024,
      FY2023,
    ]);
  });

  it('編集中の未来月（allowedFutureMonth）を含む年度は残す', () => {
    expect(
      listSelectableFiscalYears([FY2025, FY2024], { maxTargetMonth: '2025-01', allowedFutureMonth: '2025-06' }),
    ).toEqual([FY2025, FY2024]);
  });
});

describe('nextTargetMonthAfterSave', () => {
  it('翌月が算定期間内なら送る（年度をまたいでも翌年度が登録済みなら送る）', () => {
    expect(
      nextTargetMonthAfterSave({ targetMonth: '2024-11', maxTargetMonth: '2025-01', fiscalYears: [FY2024] }),
    ).toBe('2024-12');
    expect(
      nextTargetMonthAfterSave({ targetMonth: '2024-03', maxTargetMonth: '2025-01', fiscalYears: [FY2024, FY2023] }),
    ).toBe('2024-04');
  });

  it('当月で保存したときは未来月へ送らない', () => {
    expect(
      nextTargetMonthAfterSave({ targetMonth: '2025-01', maxTargetMonth: '2025-01', fiscalYears: [FY2024] }),
    ).toBeNull();
  });

  it('翌月がどの算定期間にも属さなければ送らない（翌年度が未登録のまま年度末を保存したとき）', () => {
    expect(
      nextTargetMonthAfterSave({ targetMonth: '2024-03', maxTargetMonth: '2025-01', fiscalYears: [FY2023] }),
    ).toBeNull();
  });

  it('年度マスタが空の組織は当月まで送る', () => {
    expect(nextTargetMonthAfterSave({ targetMonth: '2024-12', maxTargetMonth: '2025-01', fiscalYears: [] })).toBe(
      '2025-01',
    );
  });
});
