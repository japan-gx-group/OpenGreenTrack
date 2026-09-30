'use client';

// 固定版の履歴・内容・複製と CSV 出力の画面。内容と CSV は固定版の snapshot のみから作る。

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Download, FileCheck2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useSsbjReport } from '../hooks/useSsbjReport';
import {
  getSsbjCsvVersion,
  listSsbjCsvHistory,
  listSsbjVersions,
  recordSsbjCsvGeneration,
  type SsbjCsvHistory,
  type SsbjVersionSummary,
} from '../services/versionExportService';
import { downloadSsbjVersionCsv, ssbjVersionToCsvRows } from '../services/versionCsv';
import type { SsbjCsvVersion } from '../services/versionCsv';
import { saveSsbjReportVersion } from '../services/versionClient';
import { SsbjVersionContents } from './SsbjVersionContents';
import { SsbjTrialNotice } from './SsbjTrialNotice';

export const SsbjVersions = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: isReportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const [versions, setVersions] = useState<SsbjVersionSummary[]>([]);
  const [history, setHistory] = useState<SsbjCsvHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<SsbjCsvVersion | null>(null);
  const [confirmVersionId, setConfirmVersionId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!report) return;
    let active = true;
    Promise.all([listSsbjVersions(reportId), listSsbjCsvHistory(reportId)])
      .then(([savedVersions, savedHistory]) => {
        if (active) {
          setVersions(savedVersions);
          setHistory(savedHistory);
        }
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : '保存履歴の取得に失敗しました');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, [report, reportId]);

  const handleDownload = async (versionId: string) => {
    setBusyVersionId(versionId);
    setErrorMessage('');
    try {
      const version = await getSsbjCsvVersion(reportId, versionId);
      const generatedAt = new Date().toISOString();
      const rows = ssbjVersionToCsvRows(version, generatedAt);
      const savedHistory = await recordSsbjCsvGeneration(version);
      downloadSsbjVersionCsv(version, rows, generatedAt);
      setHistory(current => [savedHistory, ...current].slice(0, 20));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'CSVの出力に失敗しました');
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleInspect = async (versionId: string) => {
    setBusyVersionId(versionId);
    setErrorMessage('');
    try {
      setSelectedVersion(await getSsbjCsvVersion(reportId, versionId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存版の取得に失敗しました');
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleCopy = async () => {
    if (!report || !confirmVersionId || busyVersionId !== null) return;
    setBusyVersionId(confirmVersionId);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const created = await saveSsbjReportVersion(reportId, report.draftRevision, confirmVersionId);
      setSuccessMessage(`版 ${created.versionNumber} を作成しました。作業中データは変更されていません。`);
      try {
        const [savedVersions, copiedVersion] = await Promise.all([
          listSsbjVersions(reportId),
          getSsbjCsvVersion(reportId, created.id),
        ]);
        setVersions(savedVersions);
        setSelectedVersion(copiedVersion);
      } catch {
        setErrorMessage('新版は作成されましたが、履歴の再取得に失敗しました。画面を再読み込みしてください。');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存版の作成に失敗しました');
    } finally {
      setConfirmVersionId(null);
      setBusyVersionId(null);
    }
  };

  const sourceVersion = versions.find(version => version.id === confirmVersionId);

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="保存履歴とCSV出力" description={report?.title ?? 'SSBJレポート'} showFiscalYear={false} primaryAction={null} />
      <div className="flex flex-col gap-4">
        <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {(reportError || errorMessage) && <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{reportError || errorMessage}</div>}
        {successMessage && <div role="status" className="rounded-md bg-primary-bg px-4 py-3 text-sm text-success">{successMessage}</div>}
        {isReportLoading || (report && isLoading) ? (
          <Card><LoadingIndicator label="保存履歴を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report ? (
          <>
            <Card>
              <h2 className="m-0 mb-3 text-base font-bold">固定版</h2>
              {versions.length === 0 ? <p className="text-sm text-text-muted">保存版はまだありません。</p> : (
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {versions.map(version => (
                    <li key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div className="min-w-0 text-sm">
                        <p className="m-0 font-semibold">版 {version.versionNumber}</p>
                        <p className="m-0 text-text-muted">{new Date(version.createdAt).toLocaleString('ja-JP')} · {version.id}</p>
                        <p className="m-0 text-text-muted">作成者: {version.creatorName}</p>
                        {version.sourceVersionId && <p className="m-0 text-text-muted">版 {versions.find(item => item.id === version.sourceVersionId)?.versionNumber ?? version.sourceVersionId} から作成</p>}
                        {version.note && <p className="m-0 text-text-muted">{version.note}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={busyVersionId !== null} onClick={() => void handleInspect(version.id)}>
                          内容を見る
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={busyVersionId !== null} onClick={() => setConfirmVersionId(version.id)}>
                          <Copy size={14} /> この版から新版を作成
                        </Button>
                        <Button type="button" size="sm" disabled={busyVersionId !== null} onClick={() => void handleDownload(version.id)}>
                          <Download size={14} /> {busyVersionId === version.id ? '処理中...' : 'CSVを出力'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {selectedVersion && (
              <Card>
                <h2 className="m-0 mb-4 text-base font-bold">版 {selectedVersion.versionNumber} の保存内容</h2>
                <SsbjVersionContents version={selectedVersion} />
              </Card>
            )}
            <Card>
              <h2 className="m-0 mb-3 text-base font-bold">CSV生成履歴（直近20件）</h2>
              {history.length === 0 ? <p className="text-sm text-text-muted">生成履歴はありません。</p> : (
                <ul className="m-0 list-none space-y-2 p-0 text-sm">
                  {history.map(item => <li key={item.id}>版 {item.versionNumber} · {new Date(item.createdAt).toLocaleString('ja-JP')} · {item.versionId}</li>)}
                </ul>
              )}
            </Card>
          </>
        ) : null}
      </div>
      <Dialog open={confirmVersionId !== null} onOpenChange={open => { if (!open && busyVersionId === null) setConfirmVersionId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>版 {sourceVersion?.versionNumber} から新版を作成</DialogTitle>
            <DialogDescription>
              この版の保存内容を新しい固定版として複製します。元の版と現在の作業中データは変更されません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busyVersionId !== null} onClick={() => setConfirmVersionId(null)}>キャンセル</Button>
            <Button type="button" disabled={busyVersionId !== null} onClick={() => void handleCopy()}>
              {busyVersionId !== null ? '作成中...' : '新版を作成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
