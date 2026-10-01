'use client';

// SSBJ レポートの新規作成ダイアログ。レポートはヘッダーで選択中の年度に作る
// （年度はここで選ばせず、選択中の年度を明示する。作成後は年度を変更できないため）。

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { FormEvent } from 'react';
import type { SsbjReportFormController } from '../hooks/useSsbjReportForm';
import { SsbjReportFormFields } from './SsbjReportFormFields.client';

interface SsbjReportCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalYearLabel: string;
  form: SsbjReportFormController;
  /** 送信（成功したら呼び出し側がダイアログを閉じる）。 */
  onSubmit: (event: FormEvent) => void;
}

export const SsbjReportCreateDialog = ({
  open,
  onOpenChange,
  fiscalYearLabel,
  form,
  onSubmit,
}: SsbjReportCreateDialogProps) => (
  // 保存中は閉じさせない（作成結果を受け取る前に閉じると、作成済みか分からなくなるため）。
  <Dialog open={open} onOpenChange={next => !form.isSaving && onOpenChange(next)}>
    {/* 入力欄が多く、ノート PC の画面（高さ 720px 程度）では収まらないため、ダイアログの中をスクロールできるようにする。 */}
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>SSBJレポートの新規作成</DialogTitle>
          <DialogDescription>
            対象年度: <strong>{fiscalYearLabel}</strong>（作成後は変更できません。別の年度に作る場合はヘッダーで年度を切り替えてください）
          </DialogDescription>
        </DialogHeader>

        <SsbjReportFormFields form={form} />

        <DialogFooter>
          <Button type="button" variant="outline" disabled={form.isSaving} onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="submit" disabled={form.isSaving}>
            {form.isSaving ? '作成中...' : '作成する'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
);
