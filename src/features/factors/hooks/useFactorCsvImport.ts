'use client';

// CSVインポート（エクスポートと同じ列構成のラウンドトリップ）。
// 追加・更新の判定は buildFactorImportPlan（純関数）に委ね、ここではDB反映と結果表示のみ行う。
// ファイル選択時は取込プラン（DBに触らない純関数）を組み立てるところまで。
// 実際の書き込みは確認モーダルで承認された runImport が行う。

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import { addEmissionFactor, updateEmissionFactor, type EmissionFactor } from '../services/factorService';
import {
  buildFactorImportPlan,
  decodeFactorCsvBuffer,
  type FactorImportPlan,
  type FactorImportRowError,
} from '../services/factorCsvImport';

export interface FactorImportPreview {
  fileName: string;
  plan: FactorImportPlan;
}

export interface FactorCsvImportController {
  /** 行単位エラー（行番号つきでパネル表示する。トーストでは件数のみ通知） */
  importErrors: FactorImportRowError[];
  clearErrors: () => void;
  /**
   * 取込内容の確認（実行前）。取込は既存カスタム係数の更新を含み取り消せないため、
   * DBへ書く前に「何件追加され、どの係数が更新されるか」を必ず見せる（拠点管理と同じ導線）。
   */
  importPreview: FactorImportPreview | null;
  isImporting: boolean;
  selectFile: (file: File) => Promise<void>;
  cancelImport: () => void;
  runImport: () => Promise<void>;
}

export function useFactorCsvImport(
  database: EmissionFactor[],
  setDatabase: Dispatch<SetStateAction<EmissionFactor[]>>,
  showToast: ShowToast,
): FactorCsvImportController {
  const [importErrors, setImportErrors] = useState<FactorImportRowError[]>([]);
  const [importPreview, setImportPreview] = useState<FactorImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const selectFile = async (file: File) => {
    setImportErrors([]);
    try {
      const text = decodeFactorCsvBuffer(await file.arrayBuffer());
      setImportPreview({ fileName: file.name, plan: buildFactorImportPlan(text, database) });
    } catch (error) {
      // ヘッダー不一致・文字コード判定不能などファイル全体のエラー
      showToast(error instanceof Error ? error.message : 'CSVファイルを読み取れませんでした', 'error');
    }
  };

  const runImport = async () => {
    if (!importPreview) return;
    const { plan } = importPreview;
    setIsImporting(true);
    try {
      let addedCount = 0;
      let updatedCount = 0;
      const runtimeErrors: FactorImportRowError[] = [];
      const addedFactors: EmissionFactor[] = [];
      const updatedFactors = new Map<string, EmissionFactor>();

      // 途中の行で失敗しても残りの行は継続し、失敗行は行番号つきでエラー一覧へ集める。
      for (const item of plan.creates) {
        try {
          addedFactors.push(await addEmissionFactor(item.factor));
          addedCount++;
        } catch (error) {
          runtimeErrors.push({
            row: item.row,
            reasons: [error instanceof Error ? error.message : '排出係数の登録に失敗しました'],
          });
        }
      }
      for (const item of plan.updates) {
        try {
          const saved = await updateEmissionFactor(item.targetId, item.factor);
          updatedFactors.set(saved.id, saved);
          updatedCount++;
        } catch (error) {
          runtimeErrors.push({
            row: item.row,
            reasons: [error instanceof Error ? error.message : '排出係数の更新に失敗しました'],
          });
        }
      }

      if (addedFactors.length > 0 || updatedFactors.size > 0) {
        setDatabase(prev => [
          ...addedFactors,
          ...prev.map(item => updatedFactors.get(item.id) ?? item),
        ]);
      }

      const allErrors = [...plan.errors, ...runtimeErrors].sort((a, b) => a.row - b.row);
      setImportErrors(allErrors);
      showToast(
        `CSVインポート完了: 追加${addedCount}件・更新${updatedCount}件・スキップ${plan.skipCount}件・エラー${allErrors.length}件`,
        allErrors.length > 0 ? 'error' : 'success',
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'CSVインポートに失敗しました', 'error');
    } finally {
      setIsImporting(false);
      setImportPreview(null);
    }
  };

  return {
    importErrors,
    clearErrors: () => setImportErrors([]),
    importPreview,
    isImporting,
    selectFile,
    cancelImport: () => setImportPreview(null),
    runImport,
  };
}
