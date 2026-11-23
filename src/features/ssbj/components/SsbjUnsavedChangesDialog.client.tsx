'use client';

// SSBJ の入力画面で、保存していない入力があるまま別の画面へ移ろうとしたときの確認（useUnsavedChangesGuard と組で使う）。
// どの項目が保存されていないかを名前で示す。既定の操作は「編集に戻る」（Esc・枠の外を押したときも同じ）。
// 「保存して移動」は置かない。保存の失敗・競合・保存前の確認（本文が消える・下書きのまま）を移動の途中で扱うと、
// 利用者が結果を見ないまま画面を離れてしまうため。保存はカードの「保存」で行う。

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface SsbjUnsavedChangesDialogProps {
  open: boolean;
  /** 保存していない項目の名前。 */
  itemLabels: readonly string[];
  /** 何の入力か（「文章」「判断」など）。 */
  kindLabel?: string;
  onStay: () => void;
  onLeave: () => void;
}

export const SsbjUnsavedChangesDialog = ({
  open, itemLabels, kindLabel = '文章', onStay, onLeave,
}: SsbjUnsavedChangesDialogProps) => (
  <Dialog open={open} onOpenChange={next => { if (!next) onStay(); }}>
    <DialogContent data-testid="ssbj-unsaved-changes-dialog">
      <DialogHeader>
        <DialogTitle>保存していない{kindLabel}があります</DialogTitle>
        <DialogDescription>
          {itemLabels.length > 0 ? itemLabels.map(label => `「${label}」`).join('') : '編集中'}の{kindLabel}が保存されていません。
          移動すると、書いた内容は消えます。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onStay}>編集に戻る</Button>
        <Button type="button" variant="destructive" onClick={onLeave}>破棄して移動</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
