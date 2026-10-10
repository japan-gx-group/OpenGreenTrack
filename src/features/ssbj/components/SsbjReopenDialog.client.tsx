'use client';

// 差戻しのダイアログ。理由は必須で、操作履歴に残る（何を直すべきかを記録に残すため。サーバも理由の無い差戻しを拒否する）。
// 処理中は閉じさせない。

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const REASON_MAX_LENGTH = 1000;

interface SsbjReopenDialogProps {
  open: boolean;
  /** 承認済みからの差戻し（ロックの解除）か。説明の文言を変える。 */
  approved: boolean;
  isBusy: boolean;
  errorMessage: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export const SsbjReopenDialog = ({ open, approved, isBusy, errorMessage, onConfirm, onCancel }: SsbjReopenDialogProps) => {
  const [reason, setReason] = useState<string>('');
  const blank = reason.trim() === '';

  const close = () => {
    if (!isBusy) onCancel();
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>差戻す</DialogTitle>
          <DialogDescription>
            {approved
              ? '承認を取り消して作成中に戻し、編集できるようにします。'
              : 'レビューを終えて作成中に戻します。'}
            何を直すべきかを理由に書いてください。理由は操作履歴に残ります。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ssbj-reopen-reason">差戻しの理由（必須）</Label>
          <Textarea
            id="ssbj-reopen-reason"
            rows={4}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            disabled={isBusy}
            onChange={event => setReason(event.target.value)}
          />
          {errorMessage && <p role="alert" className="m-0 text-sm text-danger">{errorMessage}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isBusy} onClick={close}>キャンセル</Button>
          <Button type="button" disabled={isBusy || blank} onClick={() => onConfirm(reason.trim())}>
            {isBusy ? '処理中...' : '差戻す'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
