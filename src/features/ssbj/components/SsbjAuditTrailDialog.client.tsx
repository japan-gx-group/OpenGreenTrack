'use client';

// 証跡一式（R2-33）の出力の確認ダイアログ。内部メモ・内部記録を含めるかを選ばせる（既定は含めない）。処理中は閉じさせない。

import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface SsbjAuditTrailDialogProps {
  versionNumber: number | null;
  isApprovedVersion: boolean;
  internalRecords: boolean;
  onInternalRecordsChange: (value: boolean) => void;
  isExporting: boolean;
  errorMessage: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const SsbjAuditTrailDialog = ({
  versionNumber, isApprovedVersion, internalRecords, onInternalRecordsChange, isExporting, errorMessage, onConfirm, onCancel,
}: SsbjAuditTrailDialogProps) => (
  <Dialog open={versionNumber !== null} onOpenChange={next => { if (!next && !isExporting) onCancel(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>版 {versionNumber ?? ''} の証跡一式を出力</DialogTitle>
        <DialogDescription asChild>
          <div className="flex flex-col gap-2">
            <p className="m-0">
              保存版の開示値（GHG 排出量）から、算定の明細（活動量・係数・排出量）・使った係数・根拠文書と帳票・操作履歴までを、
              1 つの Excel（サマリ・明細・係数・根拠・操作履歴のシート）にまとめます。
            </p>
            <p className="m-0">
              明細は出力した時点の OGT のデータです。保存版を作った後に OGT で算定し直していると、サマリの照合が「不一致」になります。
            </p>
            {!isApprovedVersion && (
              <p className="m-0 font-semibold text-warning">この版は承認した版ではありません（社内確認用として出力されます）。</p>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={internalRecords}
          disabled={isExporting}
          onCheckedChange={checked => onInternalRecordsChange(checked === true)}
          aria-describedby="ssbj-trail-internal-note"
        />
        <span>
          内部メモ・内部記録を含める
          <span id="ssbj-trail-internal-note" className="block text-xs text-text-muted">
            根拠文書の資料名・保管先・ファイルの SHA-256、外部算定値の出典、活動量のメモなど（開示しない情報）。保証の担当者に渡すときに選びます。
          </span>
        </span>
      </label>
      {errorMessage && <p role="alert" className="m-0 text-sm text-danger">{errorMessage}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={isExporting} onClick={onCancel}>キャンセル</Button>
        <Button type="button" disabled={isExporting} onClick={onConfirm}>
          <FileSpreadsheet size={14} /> {isExporting ? '出力しています...' : 'Excel を出力'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
