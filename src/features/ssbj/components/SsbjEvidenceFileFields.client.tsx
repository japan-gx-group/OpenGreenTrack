'use client';

// 根拠文書のダイアログの「ファイルの照合用の記録」。選んだファイルの SHA-256 をブラウザの中で計算して入れる
// （ファイル本体はアップロードも保存もしない）。保管先での版 ID・保存担当は手で入力する（任意）。
import type { ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/datetime';
import type { useSsbjFileHash } from '../hooks/useSsbjFileHash';
import type { SsbjEvidenceFormValues } from '../utils/evidence';

type FileValues = Pick<SsbjEvidenceFormValues, 'fileName' | 'fileSha256' | 'fileStorageVersionId' | 'fileStoredBy'>;

export const SsbjEvidenceFileFields = ({
  values, saved, fileHash, disabled, onChange,
}: {
  values: FileValues;
  /** 保存済みの記録（新規登録では null）。同じファイルのままなら、その記録日時を出す。 */
  saved: { fileSha256: string | null; fileName: string | null; fileRecordedAt: string | null } | null;
  fileHash: ReturnType<typeof useSsbjFileHash>;
  disabled: boolean;
  onChange: (patch: Partial<FileValues>) => void;
}) => {
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const sha256 = await fileHash.hash(file);
    // 同じファイルを選び直しても change が起きるように、読み終えたら選択を空にする。
    input.value = '';
    if (sha256) onChange({ fileName: file.name, fileSha256: sha256 });
  };

  const unchanged = saved !== null && values.fileSha256 === (saved.fileSha256 ?? '') && values.fileName === (saved.fileName ?? '');

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">ファイルの照合用の記録（任意・内部記録）</legend>
      <p className="text-xs text-text-muted">
        ファイルを選ぶと、この端末の中で SHA-256 を計算して記録します。ファイルはアップロードも保存もしません。
        後で同じファイルかどうかを「照合」で確かめられます。
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="evidence-file">{values.fileSha256 ? 'ファイルを選び直す' : 'ファイルを選ぶ'}</Label>
        <Input id="evidence-file" type="file" onChange={event => void pick(event)} disabled={disabled || fileHash.isHashing} />
      </div>
      {fileHash.isHashing && <p className="text-xs text-text-muted" role="status">SHA-256 を計算しています...</p>}
      {fileHash.errorMessage && <p role="alert" className="text-sm text-danger">{fileHash.errorMessage}</p>}
      {values.fileSha256 && (
        <dl className="flex flex-col gap-1 rounded-md bg-bg-subtle p-3 text-sm" data-testid="ssbj-evidence-file-record">
          <div><dt className="text-xs font-semibold text-text-muted">ファイル名</dt><dd className="m-0 [overflow-wrap:anywhere]">{values.fileName}</dd></div>
          <div><dt className="text-xs font-semibold text-text-muted">SHA-256</dt><dd className="m-0 font-mono text-xs [overflow-wrap:anywhere]">{values.fileSha256}</dd></div>
          <div>
            <dt className="text-xs font-semibold text-text-muted">記録日時</dt>
            <dd className="m-0">{unchanged && saved?.fileRecordedAt ? formatDateTime(saved.fileRecordedAt) : '保存した日時で記録します'}</dd>
          </div>
        </dl>
      )}
      {values.fileSha256 && (
        <div>
          <Button type="button" variant="outline" size="sm" disabled={disabled || fileHash.isHashing}
            onClick={() => onChange({ fileName: '', fileSha256: '' })}>
            ファイルの記録を外す
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="evidence-storage-version">保管先での版 ID（任意・内部記録）</Label>
        <Input id="evidence-storage-version" value={values.fileStorageVersionId}
          onChange={event => onChange({ fileStorageVersionId: event.target.value })}
          placeholder="例: 文書管理の版番号" disabled={disabled} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="evidence-stored-by">保存担当（任意・内部記録）</Label>
        <Input id="evidence-stored-by" value={values.fileStoredBy}
          onChange={event => onChange({ fileStoredBy: event.target.value })}
          placeholder="例: 総務部 担当者名" disabled={disabled} />
      </div>
    </fieldset>
  );
};
