// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import {
  useBulkMonthEntries,
  type BulkMonthEntriesView,
  type UseBulkMonthEntriesArgs,
} from '../useBulkMonthEntries';

// 一括入力グリッドの状態フックの回帰テスト。
// 対象年度の選択肢（全月が未来の年度を出さない・当月が属する年度を既定にする）と、
// 活動量の入力フィルタが単月入力の活動量欄と同じ扱い（全角・カンマの正規化、IME 変換中は巻き戻さない、
// 数字にならない入力は直前の値へ戻して理由を立てる）であることを固定する。

const FY2023: FiscalYearOption = {
  id: 'fy2023', label: '2023年度', year: '2023', startDate: '2023-04-01', endDate: '2024-03-31',
};
const FY2024: FiscalYearOption = {
  id: 'fy2024', label: '2024年度', year: '2024', startDate: '2024-04-01', endDate: '2025-03-31',
};
const FY2025: FiscalYearOption = {
  id: 'fy2025', label: '2025年度', year: '2025', startDate: '2025-04-01', endDate: '2026-03-31',
};

let latest: BulkMonthEntriesView | null = null;

// フックの戻り値をテスト側へ渡す。render 中の外部変数への代入は副作用になるため effect で行う
// （render / act は戻った時点で effect まで反映済みなので、view() は常に最新のレンダー結果を指す）。
const Probe = (args: UseBulkMonthEntriesArgs) => {
  const view = useBulkMonthEntries(args);
  useEffect(() => {
    latest = view;
  });
  return null;
};

const setup = (overrides: Partial<UseBulkMonthEntriesArgs> = {}) => {
  render(<Probe enabled fiscalYears={[FY2025, FY2024, FY2023]} maxTargetMonth="2025-01" {...overrides} />);
  return () => latest!;
};

describe('useBulkMonthEntries', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    latest = null;
  });

  it('全月が未来の年度は対象年度の選択肢に出さず、当月が属する年度を既定にして月を列挙する', () => {
    const view = setup();

    expect(view().fiscalYearOptions.map((fiscalYear) => fiscalYear.id)).toEqual(['fy2024', 'fy2023']);
    expect(view().fiscalYearId).toBe('fy2024');
    expect(view().months).toEqual([
      '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09',
      '2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03',
    ]);
    expect(view().representativeMonth).toBe('2024-04');
  });

  it('当月がどの年度にも属さなければ直近に開始した年度を既定にし、年度を変えると入力値を破棄する', () => {
    const view = setup({ fiscalYears: [FY2025, FY2023] });

    expect(view().fiscalYearId).toBe('fy2023');
    act(() => view().setAmount('2023-04', '100'));
    expect(view().amounts['2023-04']).toBe('100');

    // 選択肢に無い年度（全月が未来）は選べず、既定のまま。
    act(() => view().selectFiscalYear('fy2025'));
    expect(view().fiscalYearId).toBe('fy2023');
    expect(view().amounts).toEqual({});
  });

  it('全角数字・カンマは半角へ正規化して受け付け、数字にならない入力は直前の値へ戻して理由を立てる', () => {
    const view = setup();

    act(() => view().setAmount('2024-11', '１２，３４５．５'));
    expect(view().amounts['2024-11']).toBe('12345.5');
    expect(view().amountRejected['2024-11']).toBe(false);

    act(() => view().setAmount('2024-11', '12345.5a'));
    expect(view().amounts['2024-11']).toBe('12345.5');
    expect(view().amountRejected['2024-11']).toBe(true);

    act(() => view().setAmount('2024-11', '12345.56'));
    expect(view().amounts['2024-11']).toBe('12345.56');
    expect(view().amountRejected['2024-11']).toBe(false);
  });

  it('IME 変換中はそのまま表示し、確定時に正規化する（数字にならなければ変換開始時点の値へ戻す）', () => {
    const view = setup();
    act(() => view().setAmount('2024-11', '12'));

    act(() => view().beginAmountComposition('2024-11'));
    act(() => view().setAmount('2024-11', '12３４'));
    expect(view().amounts['2024-11']).toBe('12３４');
    act(() => view().endAmountComposition('2024-11', '12３４'));
    expect(view().amounts['2024-11']).toBe('1234');
    expect(view().amountRejected['2024-11']).toBe(false);

    act(() => view().beginAmountComposition('2024-11'));
    act(() => view().setAmount('2024-11', '1234とうきょう'));
    act(() => view().endAmountComposition('2024-11', '1234とうきょう'));
    expect(view().amounts['2024-11']).toBe('1234');
    expect(view().amountRejected['2024-11']).toBe(true);
  });

  it('上書きの ON で既存の活動量を初期表示し、OFF で入力を破棄する', () => {
    const view = setup();

    act(() => view().toggleOverwrite('2024-10', 500));
    expect(view().overwriteEnabled['2024-10']).toBe(true);
    expect(view().amounts['2024-10']).toBe('500');

    act(() => view().toggleOverwrite('2024-10', 500));
    expect(view().overwriteEnabled['2024-10']).toBe(false);
    expect(view().amounts['2024-10']).toBe('');
  });
});
