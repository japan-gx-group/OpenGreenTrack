'use client';

// カスタム係数の削除確認。状態と削除処理は useFactorDelete が持つ。

import { AlertCircle, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal.client';
import type { FactorDeleteController } from '../hooks/useFactorDelete';

export const FactorDeleteDialog = ({ factorDelete }: { factorDelete: FactorDeleteController }) => (
  <Modal
    isOpen={factorDelete.factorToDelete !== null}
    onClose={() => { if (!factorDelete.isDeleting) factorDelete.cancelDelete(); }}
    title="排出係数の削除確認"
  >
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
        <div className="text-sm text-text-main">
          <p>
            係数「<strong>{factorDelete.factorToDelete?.name}</strong>」を削除してもよろしいですか？
          </p>
          <p className="mt-2 text-text-muted">
            この操作は取り消せません。
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="gt-btn"
          onClick={factorDelete.cancelDelete}
          disabled={factorDelete.isDeleting}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="gt-btn-primary bg-danger hover:bg-danger/90 flex items-center gap-2"
          onClick={() => void factorDelete.confirmDelete()}
          disabled={factorDelete.isDeleting}
        >
          {factorDelete.isDeleting && <Loader2 size={16} className="animate-spin" />}
          削除する
        </button>
      </div>
    </div>
  </Modal>
);
