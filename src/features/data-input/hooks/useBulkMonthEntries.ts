'use client';

// 複数月まとめて入力（一括入力）グリッドの状態。
// 入力方法（単月 / 一括）・対象年度・月ごとの活動量・上書き選択を 1 箇所に持つ。
// 行の組み立て（既存レコード照合・未来月ガード）は入力単位（適用係数に依存）が必要で、
// 係数選択フックより後にしか確定しないため、このフックは月リストまでを導出し、
// 行はフォーム本体が services/bulkEntry.ts の buildBulkMonthRows で組み立てる。
// 確認モーダル（係数解決を伴う）は useBulkEntryPreview に分ける。

import { useMemo, useState } from 'react';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import { listFiscalYearMonths } from '../services/bulkEntry';
import { DECIMAL_PATTERN } from '../services/entrySubmission';
import { findFiscalYearForDate } from '../services/inlineCalculation';

export type EntryInputMode = 'single' | 'bulk';

export interface UseBulkMonthEntriesArgs {
  /** 一括入力を使える画面か（新規入力のみ）。false の間は月リストを組み立てない */
  enabled: boolean;
  fiscalYears: FiscalYearOption[];
  /** 当月（'YYYY-MM'）。これより後の月は入力不可 */
  maxTargetMonth: string;
}

export interface BulkMonthEntriesView {
  mode: EntryInputMode;
  setMode: (mode: EntryInputMode) => void;
  /** 対象年度の選択肢（開始日の新しい順） */
  fiscalYearOptions: FiscalYearOption[];
  /** 実効の選択年度（未選択時は当月が属する年度 → 直近に開始した年度の順で既定） */
  fiscalYearId: string | null;
  selectFiscalYear: (fiscalYearId: string) => void;
  /** 選択年度に含まれる月（'YYYY-MM'・開始月から昇順） */
  months: string[];
  /** 係数の参照に使う代表月（年度内で最初の入力可能な月。全月未来なら null） */
  representativeMonth: string | null;
  amounts: Record<string, string>;
  setAmount: (month: string, value: string) => void;
  overwriteEnabled: Record<string, boolean>;
  /** 上書きの ON/OFF。ON で既存の活動量を初期表示し、OFF で入力を破棄する */
  toggleOverwrite: (month: string, existingAmount: number | null) => void;
  /** 保存成功後に入力値を破棄する */
  clearAmounts: () => void;
}

export const useBulkMonthEntries = (args: UseBulkMonthEntriesArgs): BulkMonthEntriesView => {
  const [mode, setMode] = useState<EntryInputMode>('single');
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [overwriteEnabled, setOverwriteEnabled] = useState<Record<string, boolean>>({});

  const fiscalYearOptions = useMemo(
    () => [...args.fiscalYears].sort((a, b) => (a.startDate < b.startDate ? 1 : -1)),
    [args.fiscalYears],
  );

  // 既定の対象年度は「当月が属する年度」。無ければ直近に開始した年度（すべて未来なら最も古い年度）。
  const currentMonthStart = `${args.maxTargetMonth}-01`;
  const defaultFiscalYearId = useMemo(() => {
    const containing = findFiscalYearForDate(args.fiscalYears, currentMonthStart);
    if (containing) {
      return containing.id;
    }
    const started = fiscalYearOptions.find((fiscalYear) => fiscalYear.startDate <= currentMonthStart);
    return started?.id ?? fiscalYearOptions[fiscalYearOptions.length - 1]?.id ?? null;
  }, [args.fiscalYears, fiscalYearOptions, currentMonthStart]);

  // 明示選択が選択肢から消えた場合（年度マスタの更新）は既定へ戻す。
  const fiscalYearId =
    selectedFiscalYearId !== null &&
    args.fiscalYears.some((fiscalYear) => fiscalYear.id === selectedFiscalYearId)
      ? selectedFiscalYearId
      : defaultFiscalYearId;

  const months = useMemo<string[]>(() => {
    if (!args.enabled) {
      return [];
    }
    const fiscalYear = args.fiscalYears.find((candidate) => candidate.id === fiscalYearId);
    return fiscalYear ? listFiscalYearMonths(fiscalYear) : [];
  }, [args.enabled, args.fiscalYears, fiscalYearId]);

  // 月は昇順なので、最初に見つかる「当月以前」の月が年度内で最も早い入力可能な月。
  const representativeMonth = months.find((month) => month <= args.maxTargetMonth) ?? null;

  const clearAmounts = () => {
    setAmounts({});
    setOverwriteEnabled({});
  };

  return {
    mode,
    setMode,
    fiscalYearOptions,
    fiscalYearId,
    selectFiscalYear: (nextId) => {
      setSelectedFiscalYearId(nextId);
      // 年度が変われば月の並びが変わるため、月違いの誤保存を防ぐ目的で入力値を破棄する。
      clearAmounts();
    },
    months,
    representativeMonth,
    amounts,
    setAmount: (month, value) => {
      // 単月入力の活動量欄と同じ入力フィルタ（半角数字と小数点のみ）。
      if (DECIMAL_PATTERN.test(value)) {
        setAmounts((previous) => ({ ...previous, [month]: value }));
      }
    },
    overwriteEnabled,
    toggleOverwrite: (month, existingAmount) => {
      const enabling = overwriteEnabled[month] !== true;
      setOverwriteEnabled((previous) => ({ ...previous, [month]: enabling }));
      setAmounts((previous) => ({
        ...previous,
        [month]: enabling
          ? (previous[month] ?? '') || (existingAmount !== null ? String(existingAmount) : '')
          : '',
      }));
    },
    clearAmounts,
  };
};
