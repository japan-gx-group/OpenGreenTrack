'use client';

import { createContext } from 'react';

export type FiscalYearOption = {
  id: string;
  label: string;
  /** ラベル/開始日から導出した4桁の年度（表示・モック絞り込み用の互換値） */
  year: string;
  startDate: string;
  endDate: string;
};

export type FiscalYearContextValue = {
  /** 選択中の会計年度ID（UUID）。未取得・未選択時は null */
  fiscalYearId: string | null;
  /** 選択中年度の4桁表記（例: "2024"）。互換用の派生値で、選択の実体は fiscalYearId */
  fiscalYear: string;
  /** 選択肢一覧（fiscal_years マスタ由来） */
  fiscalYears: FiscalYearOption[];
  isLoading: boolean;
  setFiscalYearId: (id: string) => void;
  /**
   * 年度一覧を取り直す。Provider はルート直下にあり client 遷移で再マウントされないため、
   * 企業設定で年度を追加・削除した画面がこれを呼んで各画面の選択肢へ即時反映する。
   */
  refresh: () => Promise<void>;
};

export const FiscalYearContext = createContext<FiscalYearContextValue | null>(null);
