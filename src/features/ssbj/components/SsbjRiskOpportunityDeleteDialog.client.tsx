'use client';

// リスク・機会の削除確認ダイアログ。

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SsbjRiskOpportunityDeleteController } from '../hooks/useSsbjRiskOpportunityDelete';

interface SsbjRiskOpportunityDeleteDialogProps {
  controller: SsbjRiskOpportunityDeleteController;
  onConfirm: () => void;
}

export const SsbjRiskOpportunityDeleteDialog = ({ controller, onConfirm }: SsbjRiskOpportunityDeleteDialogProps) => (
  <Dialog open={controller.target !== null} onOpenChange={next => !next && controller.cancel()}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>リスク・機会を削除しますか？</DialogTitle>
        <DialogDescription>
          「{controller.target?.title}」を作業中の内容から削除します。作成済みの保存版からは消えません。
        </DialogDescription>
      </DialogHeader>
      {controller.errorMessage && (
        <p role="alert" className="m-0 text-sm text-danger">
          {controller.errorMessage}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={controller.isDeleting} onClick={controller.cancel}>
          キャンセル
        </Button>
        <Button type="button" variant="destructive" disabled={controller.isDeleting} onClick={onConfirm}>
          {controller.isDeleting ? '削除中...' : '削除する'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
