'use client';

// 「帳票の一覧」。組織の帳票（請求書など）を新しい順に並べ、開く・削除ができる。
// 削除できるのは、どの記録にも紐づいていない帳票だけ（記録を削除しても帳票は残るため、その後始末に使う）。
// 削除は取り消せないので、ブラウザのダイアログは使わず、行の中で「削除する」をもう一度押してもらう。

import React, { useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { formatDateTime } from '@/lib/datetime';
import { useEvidenceList } from '../hooks/useEvidenceList';
import { openEvidenceFile } from '../services/evidenceClient';
import { EVIDENCE_MIME_LABELS, formatEvidenceSize } from '../types';

export const EvidenceListModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const list = useEvidenceList(isOpen);
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const files = unlinkedOnly ? list.files.filter((file) => file.linkCount === 0) : list.files;
  const unlinkedCount = list.files.filter((file) => file.linkCount === 0).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="帳票の一覧" size="xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-text-muted">
            記録を削除しても帳票は残ります。どの記録にも紐づいていない帳票は、ここから削除できます。
          </p>
          <label className="flex items-center gap-2 text-sm text-text-main">
            <input type="checkbox" checked={unlinkedOnly} onChange={(event) => setUnlinkedOnly(event.target.checked)} />
            紐づいていない帳票だけ（{unlinkedCount} 件）
          </label>
        </div>

        {list.error && (
          <p className="text-sm text-danger" role="alert">
            {list.error}
          </p>
        )}
        {(list.deleteError || openError) && (
          <p className="text-sm text-danger" role="alert">
            {list.deleteError ?? openError}
          </p>
        )}

        {list.isLoading ? (
          <p className="text-sm text-text-muted">帳票を読み込んでいます...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-text-muted">{unlinkedOnly ? '紐づいていない帳票はありません。' : '帳票はまだありません。'}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="gt-table">
              <thead>
                <tr>
                  <th style={{ minWidth: '220px' }}>ファイル</th>
                  <th className="whitespace-nowrap">上げた人</th>
                  <th className="whitespace-nowrap">日時</th>
                  <th className="whitespace-nowrap">記録</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <div className="break-all text-sm text-text-main">{file.fileName}</div>
                      <div className="text-xs text-text-muted">
                        {EVIDENCE_MIME_LABELS[file.mimeType]}・{formatEvidenceSize(file.sizeBytes)}
                        {file.convertedFrom && `（${EVIDENCE_MIME_LABELS[file.convertedFrom]} から変換）`}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-sm">{(file.uploadedBy && list.uploaderNames.get(file.uploadedBy)) || '—'}</td>
                    <td className="whitespace-nowrap text-sm">{formatDateTime(file.createdAt)}</td>
                    <td className="whitespace-nowrap">
                      {file.linkCount > 0 ? (
                        <Badge variant="accent" size="sm">
                          {file.linkCount} 件に紐づけ
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm">
                          紐づけなし
                        </Badge>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setOpenError(null);
                            openEvidenceFile(file.storagePath).catch((error: unknown) =>
                              setOpenError(error instanceof Error ? error.message : '帳票を開けませんでした'),
                            );
                          }}
                          aria-label={`${file.fileName} を開く`}
                        >
                          <ExternalLink />
                          開く
                        </Button>
                        {confirmingId === file.id ? (
                          <>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={async () => {
                                await list.remove(file.id);
                                setConfirmingId(null);
                              }}
                              disabled={list.deletingId === file.id}
                            >
                              削除する
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                              やめる
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingId(file.id)}
                            disabled={file.linkCount > 0}
                            title={file.linkCount > 0 ? '記録から外してから削除できます' : undefined}
                            aria-label={`${file.fileName} を削除`}
                          >
                            <Trash2 />
                            削除
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};
