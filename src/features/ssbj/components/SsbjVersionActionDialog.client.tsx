'use client';

// 保存履歴の画面の確認ダイアログ（過去版から新版を作る / 過去版の内容に戻す）。処理中は閉じさせない。

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface SsbjVersionActionDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SsbjVersionActionDialog = ({
  open, title, description, confirmLabel, busyLabel, isBusy, onConfirm, onCancel,
}: SsbjVersionActionDialogProps) => (
  <Dialog open={open} onOpenChange={next => { if (!next && !isBusy) onCancel(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2">{description}</div>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isBusy} onClick={onCancel}>キャンセル</Button>
        <Button type="button" disabled={isBusy} onClick={onConfirm}>{isBusy ? busyLabel : confirmLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
