'use client';

// 拠点の削除確認モーダル。対象拠点を保持し、削除影響と Scope3積上げ件数を確認してから削除する。

import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import {
  countScope3StackedRecords,
  deleteLocation,
  getLocationDeletionImpact,
} from '../services/locationService';
import {
  canDeleteLocation,
  formatImpactPeriod,
  type LocationDeletionImpact,
} from '../services/locationDeletionGuard';
import type { LocationRecord } from '../types';

export interface LocationDeleteController {
  /** 削除確認中の拠点。null のときはモーダルを閉じている */
  locationToDelete: LocationRecord | null;
  isDeleting: boolean;
  /**
   * 拠点削除ガード（仕様書 §3.5）。対象拠点の Scope3積上げレコード件数を確認するまで
   * null（確認中）、0 なら削除可、1以上なら削除不可として案内を表示する。
   */
  scope3BlockCount: number | null;
  /** 削除影響（紐づく活動量・算定結果の件数と対象期間）。モーダルを開くたびに取得し直す。 */
  deletionImpact: LocationDeletionImpact | null;
  isImpactLoading: boolean;
  impactError: boolean;
  /** V-LOC-004（未算定あり）で削除不可の状態 */
  deleteBlocked: boolean;
  impactPeriodLabel: string | null;
  /** 紐づく活動量データか算定結果が 1 件でもある */
  hasLinkedData: boolean;
  openDeleteModal: (row: LocationRecord) => void;
  /** 削除実行中は閉じない */
  closeDeleteModal: () => void;
  /** 取得失敗後の「再試行」。削除影響だけを取り直す */
  retryImpact: () => void;
  confirmDelete: () => Promise<void>;
}

export function useLocationDelete(
  setDatabase: Dispatch<SetStateAction<LocationRecord[]>>,
  showToast: ShowToast,
): LocationDeleteController {
  const [locationToDelete, setLocationToDelete] = useState<LocationRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  // リセットは openDeleteModal（イベントハンドラ）側で行う（effect 本体での同期 setState は
  // lint（set-state-in-effect）で禁止のため）。
  const [scope3BlockCount, setScope3BlockCount] = useState<number | null>(null);
  const [deletionImpact, setDeletionImpact] = useState<LocationDeletionImpact | null>(null);
  const [isImpactLoading, setIsImpactLoading] = useState<boolean>(false);
  const [impactError, setImpactError] = useState<boolean>(false);
  // モーダルの開き直しで古い取得結果が後着しても表示しないよう、現在の対象拠点 id を控える。
  const deleteTargetIdRef = useRef<string | null>(null);

  // 削除影響（件数・対象期間）を取得する。モーダルを開いたときと、取得失敗後の「再試行」から呼ぶ。
  // 取得に失敗した間は削除可否（V-LOC-004）を判断できないため、impactError を立てて
  //   削除ボタンを無効化したままにする（Scope3 チェックと同じく安全側に倒す）。
  const loadDeletionImpact = (locationId: string) => {
    setDeletionImpact(null);
    setImpactError(false);
    setIsImpactLoading(true);
    getLocationDeletionImpact(locationId)
      .then(impact => {
        if (deleteTargetIdRef.current === locationId) setDeletionImpact(impact);
      })
      .catch(() => {
        if (deleteTargetIdRef.current === locationId) setImpactError(true);
      })
      .finally(() => {
        if (deleteTargetIdRef.current === locationId) setIsImpactLoading(false);
      });
  };

  // 削除確認モーダルを開き、削除影響（件数・対象期間）と Scope3積上げレコード件数を取得する。
  // 取得中・取得失敗中は削除ボタンを無効化し、未算定がある場合は取得後も無効のまま理由を表示する（V-LOC-004）。
  // Scope3積上げレコードが1件でもあれば削除不可として案内に切り替える（§3.5）。
  // どちらの取得も、モーダルを開き直したときに古い結果が後着しても反映しないよう id で照合する。
  const openDeleteModal = (row: LocationRecord) => {
    deleteTargetIdRef.current = row.id;
    setLocationToDelete(row);
    setScope3BlockCount(null);
    loadDeletionImpact(row.id);
    // Scope3 の確認に失敗した場合は、削除可否を判断できないためモーダルを閉じて通知する（安全側）。
    countScope3StackedRecords(row.id)
      .then(count => {
        if (deleteTargetIdRef.current === row.id) setScope3BlockCount(count);
      })
      .catch(() => {
        if (deleteTargetIdRef.current !== row.id) return;
        showToast('Scope3積上げデータの確認に失敗しました', 'error');
        deleteTargetIdRef.current = null;
        setLocationToDelete(null);
      });
  };

  const closeDeleteModal = () => {
    if (isDeleting) return;
    deleteTargetIdRef.current = null;
    setLocationToDelete(null);
  };

  const retryImpact = () => {
    if (locationToDelete) loadDeletionImpact(locationToDelete.id);
  };

  // 削除の確定。cascade で紐づく活動量データ・算定結果も消える点は確認モーダルで警告済み。
  // 未算定の活動量データが残る場合は deleteLocation 側の事前チェックでも拒否される（V-LOC-004）。
  // Scope3積上げレコードを持つ拠点は削除不可（確認完了前・ブロック中は実行しない。
  //   deleteLocation 内でも再検証されるため、確認後に明細が増えたケースも安全）。
  // 削除影響が未取得（取得中・取得失敗）の間も実行しない。ボタンの disabled と二重のガード。
  const confirmDelete = async () => {
    if (!locationToDelete || isDeleting || scope3BlockCount === null || scope3BlockCount > 0) return;
    if (deletionImpact === null || !canDeleteLocation(deletionImpact)) return;
    try {
      setIsDeleting(true);
      const result = await deleteLocation(locationToDelete.id);
      setDatabase(prev => prev.filter(item => item.id !== locationToDelete.id));
      // 削除は成立している。集計の再計算だけ失敗した場合は成功扱いのまま警告を出す。
      if (result.warning) {
        showToast(result.warning, 'error');
      } else {
        showToast(`拠点「${locationToDelete.name}」を削除しました`, 'success');
      }
      deleteTargetIdRef.current = null;
      setLocationToDelete(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '拠点の削除に失敗しました', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // 削除確認モーダル用の派生値。deleteBlocked は V-LOC-004（未算定あり）で削除不可の状態。
  const deleteBlocked = deletionImpact !== null && !canDeleteLocation(deletionImpact);
  const impactPeriodLabel = deletionImpact ? formatImpactPeriod(deletionImpact) : null;
  const hasLinkedData =
    deletionImpact !== null &&
    (deletionImpact.activityRecordCount > 0 || deletionImpact.emissionResultCount > 0);

  return {
    locationToDelete,
    isDeleting,
    scope3BlockCount,
    deletionImpact,
    isImpactLoading,
    impactError,
    deleteBlocked,
    impactPeriodLabel,
    hasLinkedData,
    openDeleteModal,
    closeDeleteModal,
    retryImpact,
    confirmDelete,
  };
}
