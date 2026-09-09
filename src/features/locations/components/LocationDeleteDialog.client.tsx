'use client';

// 拠点の削除確認。cascade で紐づく活動量データ・算定結果も消えるため強く警告する。
// モーダルを開いた時点で影響件数・対象期間を取得して表示し、
// 未算定の活動量データが残る場合は削除ボタンを無効化する（V-LOC-004）。
// 取得に失敗した場合も削除ボタンは無効のまま「再試行」を案内する。
// 状態と取得・削除処理は useLocationDelete が持つ。

import type { RefObject } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal.client';
import type { LocationDeleteController } from '../hooks/useLocationDelete';
import { buildScope3DeleteBlockMessage } from '../services/locationService';

interface LocationDeleteDialogProps {
  locationDelete: LocationDeleteController;
  /** 閉じたあとにフォーカスを戻す要素（行メニューの ⋮） */
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export const LocationDeleteDialog = ({ locationDelete, returnFocusRef }: LocationDeleteDialogProps) => (
  <Modal
    isOpen={locationDelete.locationToDelete !== null}
    onClose={locationDelete.closeDeleteModal}
    title="拠点の削除確認"
    returnFocusRef={returnFocusRef}
  >
    <div className="flex flex-col gap-6">
      {/* Scope3積上げレコードを持つ拠点は削除をブロックし、明細の移動/削除を案内する（§3.5）。 */}
      {locationDelete.scope3BlockCount !== null && locationDelete.scope3BlockCount > 0 ? (
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
          <div className="text-sm text-text-main">
            <p>
              拠点「<strong>{locationDelete.locationToDelete?.name}</strong>」は削除できません。
            </p>
            <p className="mt-2 text-text-muted">
              {buildScope3DeleteBlockMessage(locationDelete.scope3BlockCount)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
          <div className="text-sm text-text-main">
            <p>
              拠点「<strong>{locationDelete.locationToDelete?.name}</strong>」を削除してもよろしいですか？
            </p>
            {/* 削除影響の表示。取得中 → ローディング / 取得失敗 → 再試行の導線（削除は不可） / 取得済み → 件数と期間 */}
            {locationDelete.isImpactLoading ? (
              <p className="mt-2 text-text-muted flex items-center gap-2">
                <Loader2 size={14} className="animate-spin shrink-0" />
                削除の影響範囲を確認しています...
              </p>
            ) : locationDelete.impactError ? (
              // 理由と再試行の案内を別行に分け、画面幅に関わらず文が詰まって見えないようにする。
              <div className="mt-2 text-danger">
                <p>削除の影響範囲を取得できなかったため削除できません。</p>
                <p className="mt-1">
                  <button
                    type="button"
                    onClick={locationDelete.retryImpact}
                    className="font-medium text-primary underline"
                  >
                    再試行
                  </button>
                  してください。
                </p>
              </div>
            ) : locationDelete.deletionImpact !== null && (
              locationDelete.hasLinkedData ? (
                <p className="mt-2 text-text-muted">
                  この拠点には活動量データ {locationDelete.deletionImpact.activityRecordCount} 件・
                  算定結果 {locationDelete.deletionImpact.emissionResultCount} 件
                  {locationDelete.impactPeriodLabel ? `（${locationDelete.impactPeriodLabel}）` : ''}が登録されています。
                </p>
              ) : (
                <p className="mt-2 text-text-muted">
                  この拠点に登録されている活動量データ・算定結果はありません。
                </p>
              )
            )}
            {/* 紐づくデータが無いと確定した場合以外は、cascade 削除の警告を常に出す（安全側）。 */}
            {!(locationDelete.deletionImpact !== null && !locationDelete.hasLinkedData) && (
              <p className="mt-2 text-text-muted">
                この拠点に紐づく活動量データ・算定結果もすべて削除され、元に戻せません。
              </p>
            )}
            {locationDelete.deleteBlocked && (
              <p className="mt-2 font-semibold text-danger">
                未算定の活動量データが {locationDelete.deletionImpact?.uncalculatedCount} 件あるため削除できません。
                先に算定を実行してください。
              </p>
            )}
            {locationDelete.scope3BlockCount === null && (
              <p className="mt-2 flex items-center gap-1.5 text-text-muted">
                <Loader2 size={13} className="animate-spin" /> Scope3積上げデータの有無を確認しています...
              </p>
            )}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="gt-btn"
          onClick={locationDelete.closeDeleteModal}
          disabled={locationDelete.isDeleting}
        >
          {locationDelete.scope3BlockCount !== null && locationDelete.scope3BlockCount > 0 ? '閉じる' : 'キャンセル'}
        </button>
        {(locationDelete.scope3BlockCount === null || locationDelete.scope3BlockCount === 0) && (
          <button
            type="button"
            className="gt-btn-primary bg-danger hover:bg-danger/90 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => void locationDelete.confirmDelete()}
            disabled={
              locationDelete.isDeleting || locationDelete.isImpactLoading || locationDelete.impactError || locationDelete.deleteBlocked || locationDelete.scope3BlockCount === null
            }
          >
            {locationDelete.isDeleting && <Loader2 size={16} className="animate-spin" />}
            削除する
          </button>
        )}
      </div>
    </div>
  </Modal>
);
