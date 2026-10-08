'use client';

// SSBJ レポートの簡易プレビュー画面（T12）。作業中の内容と保存版を切り替えて表示し、印刷ビュー（PDF）を開ける。
// 表示の本体は SsbjPreviewDocument（印刷ビューと共通）。内部メモは既定で隠し、利用者が選んだときだけ出す。
// 内部メモの表示は画面の中だけの切替で、印刷ビュー（PDF）には渡さない。印刷・PDF は社外に共有されうるため、
// 「開示しない」内部メモ・内部記録は画面での表示の有無にかかわらず出力しない。

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Printer, RefreshCw } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjPreviewSource } from '../hooks/useSsbjPreviewSource';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { useSsbjVersionSummaries } from '../hooks/useSsbjVersionSummaries';
import { formatPreviewSelection, parsePreviewSelection, type SsbjPreviewSelection } from '../utils/preview';
import { SsbjPreviewDocument } from './SsbjPreviewDocument';
import { SsbjTrialNotice } from './SsbjTrialNotice';

export const SsbjPreview = ({ reportId, initialSource = null }: { reportId: string; initialSource?: string | null }) => {
  const { report, isLoading: reportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const [selection, setSelection] = useState<SsbjPreviewSelection>(() => parsePreviewSelection(initialSource));
  const [showInternalNotes, setShowInternalNotes] = useState(false);
  const versions = useSsbjVersionSummaries(report?.id ?? null);
  const preview = useSsbjPreviewSource(report?.id ?? null, selection);

  const printHref = `/ssbj/${encodeURIComponent(reportId)}/preview/print?source=${encodeURIComponent(
    formatPreviewSelection(selection),
  )}`;
  const errorMessage = reportError || versions.errorMessage || preview.errorMessage;

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title="プレビュー"
        description={report?.title ?? 'SSBJレポート'}
        showFiscalYear={false}
        primaryAction={report ? (
          <Button asChild variant="outline">
            <Link href={printHref} target="_blank" rel="noopener noreferrer">
              <Printer size={16} /> 印刷・PDFとして保存
            </Link>
          </Button>
        ) : null}
      />
      <div className="flex flex-col gap-4">
        <Link
          href={`/ssbj/${encodeURIComponent(reportId)}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {errorMessage && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{errorMessage}</div>
        )}
        {reportLoading ? (
          <Card><LoadingIndicator label="レポートを読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report ? (
          <>
            <Card>
              <div className="flex flex-wrap items-end gap-4">
                <div className="flex min-w-64 flex-col gap-1">
                  <Label htmlFor="ssbj-preview-source">表示する内容</Label>
                  <Select
                    value={formatPreviewSelection(selection)}
                    onValueChange={value => setSelection(parsePreviewSelection(value))}
                    disabled={versions.isLoading}
                  >
                    <SelectTrigger id="ssbj-preview-source" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="working">作業中の内容（未保存の変更を含む）</SelectItem>
                      {versions.versions.map(version => (
                        <SelectItem key={version.id} value={version.id}>
                          保存版 第{version.versionNumber}版（{formatDateTime(version.createdAt)}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox
                    id="ssbj-preview-internal"
                    checked={showInternalNotes}
                    onCheckedChange={checked => setShowInternalNotes(checked === true)}
                  />
                  <Label htmlFor="ssbj-preview-internal">内部メモも表示する（開示しない内容）</Label>
                </div>
                {selection.kind === 'working' && (
                  <Button type="button" variant="outline" size="sm" disabled={preview.isLoading} onClick={preview.reload}>
                    <RefreshCw size={14} /> 作業中の内容を読み直す
                  </Button>
                )}
              </div>
            </Card>
            {preview.isLoading ? (
              <Card><LoadingIndicator label="プレビューを組み立てています..." /></Card>
            ) : preview.source ? (
              <Card>
                <SsbjPreviewDocument source={preview.source} showInternalNotes={showInternalNotes} />
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
};
