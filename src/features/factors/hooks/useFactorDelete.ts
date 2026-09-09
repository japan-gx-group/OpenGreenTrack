'use client';

// カスタム係数の削除確認モーダル。対象を保持し、確定時に削除する。
// 削除中フラグはテーブル取得用の isLoading とは分ける（「クエリを実行中...」の
// オーバーレイを出さないため。他画面の削除モーダルとも揃える）。

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import { deleteEmissionFactor, type EmissionFactor } from '../services/factorService';

export interface FactorDeleteController {
  /** 削除確認中の係数。null のときはモーダルを閉じている */
  factorToDelete: EmissionFactor | null;
  isDeleting: boolean;
  /** 削除確認を開く。標準係数は画面から削除できないので弾く */
  requestDelete: (factor: EmissionFactor) => void;
  cancelDelete: () => void;
  confirmDelete: () => Promise<void>;
}

export function useFactorDelete(
  setDatabase: Dispatch<SetStateAction<EmissionFactor[]>>,
  showToast: ShowToast,
): FactorDeleteController {
  const [factorToDelete, setFactorToDelete] = useState<EmissionFactor | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const requestDelete = (factor: EmissionFactor) => {
    if (!factor.isCustom) {
      showToast('標準係数は画面から直接削除できません', 'error');
      return;
    }

    setFactorToDelete(factor);
  };

  const cancelDelete = () => setFactorToDelete(null);

  const confirmDelete = async () => {
    if (!factorToDelete || isDeleting) return;

    const { id, name } = factorToDelete;
    setIsDeleting(true);
    try {
      await deleteEmissionFactor(id);
      setDatabase(prev => prev.filter(item => item.id !== id));
      showToast(`「${name}」を削除しました`, 'success');
      setFactorToDelete(null);
    } catch (error) {
      // 失敗時はモーダルを開いたままにして再試行できるようにする。
      showToast(error instanceof Error ? error.message : '排出係数の削除に失敗しました', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return { factorToDelete, isDeleting, requestDelete, cancelDelete, confirmDelete };
}
