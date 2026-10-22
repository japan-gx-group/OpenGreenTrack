'use client';

// 一括入力の確認モーダル用の状態。開く際にグリッドの入力値を検証し、月ごとの係数解決
// （Supabase からの係数マスタ取得を伴う）→ 保存内容と表示内容の組み立てまでを行う。
// グリッド自体の状態（useBulkMonthEntries）とは関心を分ける。

import { useCallback, useState } from 'react';
import type { IdeaProductDetail } from '@/features/factors/services/ideaProductSearch';
import type { ManualEntryLocationOption } from '../types';
import {
  buildBulkPreview,
  buildBulkSaveItems,
  collectBulkEntries,
  type BulkMonthRow,
  type BulkPreview,
  type BulkSaveItem,
} from '../services/bulkEntry';
import {
  resolveBulkMonthFactors,
  type BulkFactorSelectionState,
  type BulkMonthFactor,
} from '../services/bulkFactorResolution';
import type { EntryCategory } from '../services/entryCategory';
import { VALIDATION_MESSAGES } from '../services/entrySubmission';
import type { FiscalYearRange } from '../services/inlineCalculation';

export interface BulkEntryPreviewState {
  items: BulkSaveItem[];
  preview: BulkPreview;
}

export interface BulkEntryPreviewOpenArgs {
  rows: BulkMonthRow[];
  amounts: Record<string, string>;
  overwriteEnabled: Record<string, boolean>;
  category: EntryCategory;
  location: ManualEntryLocationOption;
  unit: string;
  note: string;
  fiscalYears: FiscalYearRange[];
  /** Scope1/2 の係数選択状態（IDEA では使わない） */
  selection: BulkFactorSelectionState;
  /** IDEA のときの選択製品 */
  productDetail: IdeaProductDetail | null;
}

export interface BulkEntryPreviewView {
  state: BulkEntryPreviewState | null;
  /** 係数解決（取得）中。プレビューボタンの二重押下防止に使う */
  isResolving: boolean;
  /** 検証・組み立てを行いモーダルを開く。エラー文言を返したら開かない（null = 成功） */
  open: (args: BulkEntryPreviewOpenArgs) => Promise<string | null>;
  close: () => void;
}

export const useBulkEntryPreview = (): BulkEntryPreviewView => {
  const [state, setState] = useState<BulkEntryPreviewState | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const open = async (args: BulkEntryPreviewOpenArgs): Promise<string | null> => {
    const { entries, error } = collectBulkEntries({
      rows: args.rows,
      amounts: args.amounts,
      overwriteEnabled: args.overwriteEnabled,
    });
    if (error !== null) {
      return error;
    }

    const isIdea = args.category.kind === 'scope3';
    setIsResolving(true);
    try {
      let factorByMonth: ReadonlyMap<string, BulkMonthFactor> | null = null;
      if (args.category.kind === 'energy') {
        factorByMonth = await resolveBulkMonthFactors({
          months: entries.map((entry) => entry.month),
          location: args.location,
          energyType: args.category.energyType,
          fiscalYears: args.fiscalYears,
          selection: args.selection,
        });
      }
      const items = buildBulkSaveItems({
        category: args.category,
        locationId: args.location.id,
        entries,
        unit: args.unit,
        note: args.note,
        factorIdByMonth: new Map(
          entries.map((entry) => [entry.month, factorByMonth?.get(entry.month)?.factorIdToSave ?? null]),
        ),
        ideaFactorId: args.productDetail?.id ?? null,
      });
      if (items === null) {
        return VALIDATION_MESSAGES.inconsistent;
      }
      setState({
        items,
        preview: buildBulkPreview({
          entries,
          unit: args.unit,
          isIdea,
          factorByMonth,
          productDetail: args.productDetail,
          fiscalYears: args.fiscalYears,
        }),
      });
      return null;
    } catch (caught) {
      return caught instanceof Error ? caught.message : VALIDATION_MESSAGES.inconsistent;
    } finally {
      setIsResolving(false);
    }
  };

  const close = useCallback(() => setState(null), []);

  return { state, isResolving, open, close };
};
