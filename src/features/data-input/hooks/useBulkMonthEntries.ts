'use client';

// 複数月まとめて入力（一括入力）グリッドの状態。
// 入力方法（単月 / 一括）・対象年度・月ごとの活動量・上書き選択を 1 箇所に持つ。
// 行の組み立て（既存レコード照合・未来月ガード）は入力単位（適用係数に依存）が必要で、
// 係数選択フックより後にしか確定しないため、このフックは月リストまでを導出し、
// 行はフォーム本体が services/bulkEntry.ts の buildBulkMonthRows で組み立てる。
// 確認モーダル（係数解決を伴う）は useBulkEntryPreview に分ける。
// 活動量の入力フィルタは単月入力の活動量欄と同じ（全角数字・カンマの正規化、IME 変換中は巻き戻さない、
// 数字にならない入力は直前の値へ戻して理由を出す）。

import { useMemo, useRef, useState } from 'react';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import { DECIMAL_PATTERN, normalizeAmountInput } from '../services/entrySubmission';
import { findFiscalYearForDate } from '../services/inlineCalculation';
import { listSelectableFiscalYears, listYearMonthsInRange } from '../services/targetMonthSelection';

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
  /** 対象年度の選択肢（開始日の新しい順）。入力できる月を 1 つも持たない年度（全月が未来）は含めない */
  fiscalYearOptions: FiscalYearOption[];
  /** 実効の選択年度（未選択時は当月が属する年度 → 直近に開始した年度の順で既定） */
  fiscalYearId: string | null;
  selectFiscalYear: (fiscalYearId: string) => void;
  /** 選択年度に含まれる月（'YYYY-MM'・開始月から昇順） */
  months: string[];
  /** 係数の参照に使う代表月（年度内で最初の入力可能な月。全月未来なら null） */
  representativeMonth: string | null;
  amounts: Record<string, string>;
  /** 入力フィルタ。全角数字・カンマは正規化して受け付け、数字にならない入力は直前の値に戻す */
  setAmount: (month: string, value: string) => void;
  /** 正規化しても数字にならず弾いた月（行の直下に理由を出す） */
  amountRejected: Record<string, boolean>;
  /** IME 変換の開始。変換中の値は巻き戻さず、確定時にまとめて正規化する */
  beginAmountComposition: (month: string) => void;
  /** IME 変換の確定。数字にならなければ変換開始時点の値へ戻す */
  endAmountComposition: (month: string, value: string) => void;
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
  const [amountRejected, setAmountRejected] = useState<Record<string, boolean>>({});
  const [overwriteEnabled, setOverwriteEnabled] = useState<Record<string, boolean>>({});
  // IME 変換中の月 → 変換開始時点の表示値（パターンを通過済み。確定が数字にならなかったときの戻し先）。
  const composingRef = useRef<Record<string, string>>({});

  // 全月が未来の年度は入力できる月が無いため、単月入力の年度セレクタと同じく選択肢に出さない。
  const fiscalYearOptions = useMemo(
    () =>
      listSelectableFiscalYears(args.fiscalYears, { maxTargetMonth: args.maxTargetMonth }).sort((a, b) =>
        a.startDate < b.startDate ? 1 : -1,
      ),
    [args.fiscalYears, args.maxTargetMonth],
  );

  // 既定の対象年度は「当月が属する年度」。無ければ直近に開始した年度（選択肢は新しい順なので先頭）。
  const currentMonthStart = `${args.maxTargetMonth}-01`;
  const defaultFiscalYearId = useMemo(
    () => findFiscalYearForDate(fiscalYearOptions, currentMonthStart)?.id ?? fiscalYearOptions[0]?.id ?? null,
    [fiscalYearOptions, currentMonthStart],
  );

  // 明示選択が選択肢から消えた場合（年度マスタの更新）は既定へ戻す。
  const fiscalYearId =
    selectedFiscalYearId !== null &&
    fiscalYearOptions.some((fiscalYear) => fiscalYear.id === selectedFiscalYearId)
      ? selectedFiscalYearId
      : defaultFiscalYearId;

  const months = useMemo<string[]>(() => {
    if (!args.enabled) {
      return [];
    }
    const fiscalYear = fiscalYearOptions.find((candidate) => candidate.id === fiscalYearId);
    return fiscalYear ? listYearMonthsInRange(fiscalYear.startDate, fiscalYear.endDate) : [];
  }, [args.enabled, fiscalYearOptions, fiscalYearId]);

  // 月は昇順なので、最初に見つかる「当月以前」の月が年度内で最も早い入力可能な月。
  const representativeMonth = months.find((month) => month <= args.maxTargetMonth) ?? null;

  const clearAmounts = () => {
    setAmounts({});
    setAmountRejected({});
    setOverwriteEnabled({});
    composingRef.current = {};
  };

  // 正規化して受け付け、数字にならなければ fallback（現在の表示値から決める）へ戻して理由を立てる。
  const commitAmount = (month: string, raw: string, fallback: (current: string) => string) => {
    const normalized = normalizeAmountInput(raw);
    const accepted = DECIMAL_PATTERN.test(normalized);
    setAmounts((previous) => ({
      ...previous,
      [month]: accepted ? normalized : fallback(previous[month] ?? ''),
    }));
    setAmountRejected((previous) => ({ ...previous, [month]: !accepted }));
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
      if (month in composingRef.current) {
        // 変換中は巻き戻さずそのまま表示する（確定時に commitAmount で正規化する）。
        setAmounts((previous) => ({ ...previous, [month]: value }));
        return;
      }
      // 変換を介さない入力では表示中の値がそのまま戻す先になる。
      commitAmount(month, value, (current) => (DECIMAL_PATTERN.test(current) ? current : ''));
    },
    amountRejected,
    beginAmountComposition: (month) => {
      // 変換開始時点の表示値は必ずパターンを通過しているので、確定が数字にならなかったときはここへ戻す。
      composingRef.current[month] = amounts[month] ?? '';
    },
    endAmountComposition: (month, value) => {
      const fallback = composingRef.current[month] ?? '';
      delete composingRef.current[month];
      commitAmount(month, value, () => fallback);
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
      setAmountRejected((previous) => ({ ...previous, [month]: false }));
    },
    clearAmounts,
  };
};
