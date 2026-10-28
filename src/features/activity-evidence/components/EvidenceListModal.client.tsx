'use client';

// 「帳票の一覧」。組織の帳票（請求書など）を新しい順に並べ、開く・削除ができる。
// 削除できるのは、どの記録にも紐づいていない帳票だけ（記録を削除しても帳票は残るため、その後始末に使う）。
// 入力中の帳票（新規入力のフォームの欄・請求書の一括登録の表にあり、まだ記録を保存していないので紐づけなし）は、
// 保存で紐づけるので削除させない。
// 削除は取り消せないので、ブラウザのダイアログは使わず、行の中で「削除する」をもう一度押してもらう。

import React, { useId, useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/Modal.client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import { useEvidenceList } from '../hooks/useEvidenceList';
import { openEvidenceFile } from '../services/evidenceClient';
import { EVIDENCE_MIME_LABELS, formatEvidenceSize } from '../types';

const NO_PENDING: readonly string[] = [];

export const EvidenceListModal = ({
  isOpen,
  onClose,
  pendingFileIds = NO_PENDING,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 入力中の帳票の ID（フォームの欄・請求書の一括登録の表。保存で記録に紐づけるので、ここでは削除させない） */
  pendingFileIds?: readonly string[];
}) => {
  const list = useEvidenceList(isOpen);
  const unlinkedOnlyId = useId();
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
          <div className="flex items-center gap-2">
            <Checkbox
              id={unlinkedOnlyId}
              checked={unlinkedOnly}
              onCheckedChange={(checked) => setUnlinkedOnly(checked === true)}
            />
            <Label htmlFor={unlinkedOnlyId} className="font-normal text-text-main">
              紐づいていない帳票だけ（{unlinkedCount} 件）
            </Label>
          </div>
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
        {list.uploaderError && <p className="text-xs text-text-muted">{list.uploaderError}（上げた人は「—」と表示します）</p>}

        {list.isLoading ? (
          <p className="text-sm text-text-muted">帳票を読み込んでいます...</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-text-muted">{unlinkedOnly ? '紐づいていない帳票はありません。' : '帳票はまだありません。'}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">ファイル</TableHead>
                  <TableHead>上げた人</TableHead>
                  <TableHead>日時</TableHead>
                  <TableHead>記録</TableHead>
                  <TableHead aria-label="操作" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => {
                  const isPending = file.linkCount === 0 && pendingFileIds.includes(file.id);
                  return (
                    <TableRow key={file.id}>
                      <TableCell className="whitespace-normal">
                        <div className="break-all text-sm text-text-main">{file.fileName}</div>
                        <div className="text-xs text-text-muted">
                          {EVIDENCE_MIME_LABELS[file.mimeType]}・{formatEvidenceSize(file.sizeBytes)}
                          {file.convertedFrom && `（${EVIDENCE_MIME_LABELS[file.convertedFrom]} から変換）`}
                        </div>
                      </TableCell>
                      <TableCell>{(file.uploadedBy && list.uploaderNames.get(file.uploadedBy)) || '—'}</TableCell>
                      <TableCell className="whitespace-normal">{formatDateTime(file.createdAt)}</TableCell>
                      <TableCell>
                        {file.linkCount > 0 ? (
                          <Badge variant="accent" size="sm">
                            {file.linkCount} 件に紐づけ
                          </Badge>
                        ) : isPending ? (
                          <Badge variant="info" size="sm">
                            入力中
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            紐づけなし
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
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
                                size="xs"
                                onClick={async () => {
                                  await list.remove(file.id);
                                  setConfirmingId(null);
                                }}
                                disabled={list.deletingId === file.id}
                              >
                                削除する
                              </Button>
                              <Button type="button" variant="ghost" size="xs" onClick={() => setConfirmingId(null)}>
                                やめる
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setConfirmingId(file.id)}
                              disabled={file.linkCount > 0 || isPending}
                              title={
                                file.linkCount > 0
                                  ? '記録から外してから削除できます'
                                  : isPending
                                    ? '入力中のフォーム、または請求書の読取りの表にある帳票です。記録を保存すると紐づきます'
                                    : undefined
                              }
                              aria-label={`${file.fileName} を削除`}
                            >
                              <Trash2 />
                              削除
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  );
};
