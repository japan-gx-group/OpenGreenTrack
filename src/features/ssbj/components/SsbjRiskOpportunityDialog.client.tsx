'use client';

// リスク・機会の登録・編集ダイアログ。

import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SsbjRiskOpportunityFormController } from '../hooks/useSsbjRiskOpportunityForm';
import { SsbjRiskOpportunityFormFields } from './SsbjRiskOpportunityFormFields.client';

interface SsbjRiskOpportunityDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  onOpenChange: (open: boolean) => void;
  form: SsbjRiskOpportunityFormController;
  /** 送信（成功したら呼び出し側がダイアログを閉じる）。 */
  onSubmit: (event: FormEvent) => void;
  /** 業種の候補を採用して登録するときの候補の名称。 */
  adoptingCandidateTitle?: string | null;
}

export const SsbjRiskOpportunityDialog = ({
  open,
  mode,
  onOpenChange,
  form,
  onSubmit,
  adoptingCandidateTitle = null,
}: SsbjRiskOpportunityDialogProps) => (
  // 保存中は閉じさせない（保存結果を受け取る前に閉じると、保存済みか分からなくなるため）。
  <Dialog open={open} onOpenChange={next => !form.isSaving && onOpenChange(next)}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'リスク・機会の登録' : 'リスク・機会の編集'}</DialogTitle>
          <DialogDescription>
            変更は作業中の内容として保存されます。保存版に残すには、レポート詳細の「保存版を作成」を押してください。
          </DialogDescription>
        </DialogHeader>

        {adoptingCandidateTitle && (
          <p data-testid="ssbj-risk-adopting-candidate" className="m-0 rounded-md bg-bg-subtle px-3 py-2 text-xs">
            業種の候補「{adoptingCandidateTitle}」を採用して登録します。名称・区分・関連する項目は自社に合わせて修正してください。
            説明・時間軸は未入力にしてあります。登録しても、該当性・重要性は確定しません。
          </p>
        )}

        <SsbjRiskOpportunityFormFields form={form} />

        <DialogFooter>
          <Button type="button" variant="outline" disabled={form.isSaving} onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="submit" disabled={form.isSaving}>
            {form.isSaving ? '保存中...' : mode === 'create' ? '登録する' : '変更を保存'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
