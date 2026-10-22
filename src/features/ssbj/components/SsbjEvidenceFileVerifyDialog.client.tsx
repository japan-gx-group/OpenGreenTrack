'use client';

// 根拠文書のファイルの照合。選んだファイルの SHA-256 をブラウザの中で計算し、記録した値と比べて一致／不一致を出す。
// 何も保存しないため、承認済みのレポートでも使える（承認した後にファイルが差し替えられていないかを確かめるため）。
import { useState, type ChangeEvent } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjFileHash } from '../hooks/useSsbjFileHash';
import type { SsbjEvidence } from '../types';

export const SsbjEvidenceFileVerifyDialog = ({
  evidence, onClose,
}: {
  evidence: SsbjEvidence | null;
  onClose: () => void;
}) => {
  const fileHash = useSsbjFileHash();
  const [checked, setChecked] = useState<{ fileName: string; sha256: string } | null>(null);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setChecked(null);
    const sha256 = await fileHash.hash(file);
    // 同じファイルを選び直しても change が起きるように、読み終えたら選択を空にする。
    input.value = '';
    if (sha256) setChecked({ fileName: file.name, sha256 });
  };

  const matches = checked !== null && checked.sha256 === evidence?.fileSha256;

  return (
    <Dialog open={evidence !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ファイルの照合</DialogTitle>
          <DialogDescription>
            記録したときのファイルと同じかを、SHA-256 で確かめます。ファイルはこの端末の中で読むだけで、送信も保存もしません。
          </DialogDescription>
        </DialogHeader>
        {evidence && (
          <dl className="flex flex-col gap-1 rounded-md bg-bg-subtle p-3 text-sm">
            <div><dt className="text-xs font-semibold text-text-muted">資料名</dt><dd className="m-0">{evidence.documentTitle}</dd></div>
            <div><dt className="text-xs font-semibold text-text-muted">記録したファイル名</dt><dd className="m-0 [overflow-wrap:anywhere]">{evidence.fileName}</dd></div>
            <div><dt className="text-xs font-semibold text-text-muted">記録した SHA-256</dt><dd className="m-0 font-mono text-xs [overflow-wrap:anywhere]">{evidence.fileSha256}</dd></div>
            <div><dt className="text-xs font-semibold text-text-muted">記録日時</dt><dd className="m-0">{evidence.fileRecordedAt ? formatDateTime(evidence.fileRecordedAt) : '未入力'}</dd></div>
          </dl>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="evidence-verify-file">照合するファイル</Label>
          <Input id="evidence-verify-file" type="file" onChange={event => void pick(event)} disabled={fileHash.isHashing} />
        </div>
        {fileHash.isHashing && <p className="text-xs text-text-muted" role="status">SHA-256 を計算しています...</p>}
        {fileHash.errorMessage && <p role="alert" className="text-sm text-danger">{fileHash.errorMessage}</p>}
        {checked && (
          <div
            role="status"
            data-testid="ssbj-evidence-verify-result"
            data-result={matches ? 'match' : 'mismatch'}
            className={`flex flex-col gap-2 rounded-md px-4 py-3 text-sm ${matches ? 'bg-success-soft text-success' : 'bg-danger-light text-danger'}`}
          >
            <p className="m-0 flex items-center gap-2 font-bold">
              {matches ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
              {matches ? '一致しました' : '一致しません'}
            </p>
            <p className="m-0">
              {matches
                ? '記録したときと同じ内容のファイルです。'
                : '記録したときと違うファイルか、ファイルの中身が変わっています。選んだファイルと保管先を確かめてください。'}
            </p>
            <p className="m-0 text-xs [overflow-wrap:anywhere]">選んだファイル: {checked.fileName}</p>
            <p className="m-0 font-mono text-xs [overflow-wrap:anywhere]">SHA-256: {checked.sha256}</p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
