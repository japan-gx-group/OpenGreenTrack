'use client';

// 固定版を指定して CSV を生成する画面。CSV は選んだ版の snapshot のみから作る。

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, FileCheck2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { SsbjTrialNotice } from './SsbjTrialNotice';

export const SsbjVersions = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: isReportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const [versions, setVersions] = useState<SsbjVersionSummary[]>([]);
  const [history, setHistory] = useState<SsbjCsvHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

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

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="保存履歴とCSV出力" description={report?.title ?? 'SSBJレポート'} showFiscalYear={false} primaryAction={null} />
      <div className="flex flex-col gap-4">
        <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {(reportError || errorMessage) && <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{reportError || errorMessage}</div>}
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
                        {version.note && <p className="m-0 text-text-muted">{version.note}</p>}
                      </div>
                      <Button type="button" size="sm" disabled={busyVersionId !== null} onClick={() => void handleDownload(version.id)}>
                        <Download size={14} /> {busyVersionId === version.id ? '出力中...' : 'CSVを出力'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
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
    </div>
  );
};
