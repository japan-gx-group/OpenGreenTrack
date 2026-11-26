'use client';

// 固定版の履歴・内容・複製・復元と、CSV / Excel 出力の画面。内容と出力は固定版の snapshot のみから作る。
// 出力は、出力履歴（system_audit_logs）と操作履歴（ssbj_audit_logs）に記録してからダウンロードさせる
// （記録できなければ出力しない）。復元は、戻す前の作業中の内容をサーバが保存版として自動で残す
// （文章の選択式テンプレートの選択は保存版に含めないので残らない。確認のダイアログで伝える）。
// 閲覧者は保存版の行を読めない（RLS）。承認した保存版の開示する内容（内部メモ・内部記録を除いたもの）だけを API から読み、
// 内容の表示と出力に使う。出力には内部記録の列を入れず、操作履歴・出力履歴（組織の全員の出力）は出さない
// （docs/authorization-matrix.md §2.3）。
// 版の行は、内容を見る・CSV・Excel だけを並べ、「この版から新版を作成」「この版の内容に戻す」は「その他の操作」に畳む
// （強い操作を出力と同じ並びに置かないため。確認のダイアログはこれまでどおり）。版 ID は控えめに出してコピーできるようにする。
// 「その他の操作」は shadcn の DropdownMenu（R14）。外を押す・Esc で閉じ、矢印キー・Enter で選べる。

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Copy, Download, FileCheck2, FileSpreadsheet, History, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { SsbjCopyableId } from './SsbjCopyableId.client';
import { recordSsbjExport } from '../services/auditLogService';
import { restoreSsbjReportVersion } from '../services/reportWorkflowClient';
import {
  getSsbjApprovedVersion,
  getSsbjCsvVersion,
  listSsbjCsvHistory,
  listSsbjVersions,
  recordSsbjCsvGeneration,
  type SsbjCsvHistory,
  type SsbjStoredVersion,
  type SsbjVersionExportFormat,
  type SsbjVersionSummary,
} from '../services/versionExportService';
import { downloadSsbjVersionCsv, ssbjVersionToCsvRows } from '../services/versionCsv';
import { saveSsbjReportVersion } from '../services/versionClient';
import { buildSsbjWorkbook, downloadSsbjWorkbook, ssbjVersionSheet, ssbjVersionXlsxFileName } from '../services/versionXlsx';
import { useSsbjMyRole } from '../hooks/useSsbjMyRole';
import { canEditSsbj, canViewSsbjWorking } from '../utils/memberRole';
import { isSsbjReportLocked } from '../utils/reportStatus';
import { SsbjLockedNotice } from './SsbjLockedNotice';
import { SsbjTrialNotice } from './SsbjTrialNotice';
import { SsbjVersionActionDialog } from './SsbjVersionActionDialog.client';
import { SsbjVersionCompare } from './SsbjVersionCompare.client';
import { SsbjVersionView } from './SsbjVersionView.client';

const FORMAT_LABELS: Record<SsbjVersionExportFormat, string> = { csv: 'CSV', xlsx: 'Excel' };

type PendingAction = { kind: 'copy' | 'restore'; versionId: string };

export const SsbjVersions = ({ reportId }: { reportId: string }) => {
  const { report, reload: reloadReport, isLoading: isReportLoading, errorMessage: reportError, isNotFound } =
    useSsbjReport(reportId);
  const myRole = useSsbjMyRole();
  const [versions, setVersions] = useState<SsbjVersionSummary[]>([]);
  const [history, setHistory] = useState<SsbjCsvHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<SsbjStoredVersion | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  // 閲覧者は、承認した保存版の開示する内容だけを API から読む。ロールが分かるまでは読まない。
  const roleKnown = !myRole.isLoading;
  const viewerOnly = roleKnown && !canViewSsbjWorking(myRole.role);

  useEffect(() => {
    if (!report || !roleKnown) return;
    let active = true;
    const load: Promise<[SsbjVersionSummary[], SsbjCsvHistory[]]> = viewerOnly
      ? getSsbjApprovedVersion(reportId).then(version => [[version], []])
      : Promise.all([listSsbjVersions(reportId), listSsbjCsvHistory(reportId)]);
    load
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
  }, [report, reportId, roleKnown, viewerOnly]);

  /** 内容の表示・出力に使う保存版。閲覧者は承認した版（内部記録を除いたもの）だけ。 */
  const loadVersion = async (versionId: string): Promise<SsbjStoredVersion> => {
    if (!viewerOnly) return getSsbjCsvVersion(reportId, versionId);
    const version = await getSsbjApprovedVersion(reportId);
    // 画面を開いた後に差戻し・承認し直しがあれば、表示していた版とは別の版になる。
    if (version.id !== versionId) throw new Error('保存版が見つかりません。画面を開き直してください');
    return version;
  };

  const handleDownload = async (versionId: string, format: SsbjVersionExportFormat) => {
    setBusyVersionId(versionId);
    setErrorMessage('');
    try {
      const version = await loadVersion(versionId);
      const generatedAt = new Date().toISOString();
      // 閲覧者の出力には内部記録の列を入れない。
      const rows = ssbjVersionToCsvRows(version, generatedAt, { internalRecords: !viewerOnly });
      // 記録してから出力する（誰がいつ出力したかを残せない出力をさせない）。
      await recordSsbjExport(reportId, format, version.id);
      const savedHistory = await recordSsbjCsvGeneration(version, format);
      if (format === 'csv') {
        downloadSsbjVersionCsv(version, rows, generatedAt);
      } else {
        await downloadSsbjWorkbook(await buildSsbjWorkbook([ssbjVersionSheet(rows)]), ssbjVersionXlsxFileName(version, generatedAt));
      }
      if (!viewerOnly) setHistory(current => [savedHistory, ...current].slice(0, 20));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `${FORMAT_LABELS[format]}の出力に失敗しました`);
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleInspect = async (versionId: string) => {
    setBusyVersionId(versionId);
    setErrorMessage('');
    try {
      setSelectedVersion(await loadVersion(versionId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存版の取得に失敗しました');
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleCopy = async (versionId: string) => {
    if (!report) return;
    const created = await saveSsbjReportVersion(reportId, report.draftRevision, versionId);
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
  };

  const handleRestore = async (versionId: string) => {
    if (!report) return;
    const result = await restoreSsbjReportVersion(reportId, versionId, report.draftRevision);
    setSuccessMessage(
      `作業中の内容を 版 ${result.restoredVersionNumber} の内容に戻しました。` +
      `戻す前の内容は 版 ${result.backupVersionNumber} として保存しています。`,
    );
    // 版数（draftRevision）が進んだので、レポートを読み直す（保存履歴も読み直される）。
    reloadReport();
  };

  const runPending = async () => {
    if (!pending || busyVersionId !== null) return;
    setBusyVersionId(pending.versionId);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      if (pending.kind === 'copy') await handleCopy(pending.versionId);
      else await handleRestore(pending.versionId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '処理に失敗しました');
    } finally {
      setPending(null);
      setBusyVersionId(null);
    }
  };

  const pendingVersion = versions.find(version => version.id === pending?.versionId);
  const locked = report ? isSsbjReportLocked(report.review) : false;
  // 過去版からの新版作成と復元は、SSBJ のロールが入力担当か管理者のときだけ出す（API も同じ判定をする）。
  const canEdit = canEditSsbj(myRole.role);

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="保存履歴と出力" description={report?.title ?? 'SSBJレポート'} showFiscalYear={false} primaryAction={null} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
            <ArrowLeft size={16} /> レポート詳細へ戻る
          </Link>
          {canViewSsbjWorking(myRole.role) && (
            <Link href={`/ssbj/${encodeURIComponent(reportId)}/history`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
              <History size={16} /> 操作履歴を見る
            </Link>
          )}
        </div>
        <SsbjTrialNotice />
        {report && <SsbjLockedNotice report={report} />}
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
                        <p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
                          <span>版 {version.versionNumber}</span>
                          {report.review.approvedVersionId === version.id && <Badge variant="success">承認した版</Badge>}
                        </p>
                        <p className="m-0 text-text-muted">{new Date(version.createdAt).toLocaleString('ja-JP')} · 作成者: {version.creatorName}</p>
                        {version.sourceVersionId && <p className="m-0 text-text-muted">版 {versions.find(item => item.id === version.sourceVersionId)?.versionNumber ?? version.sourceVersionId} から作成</p>}
                        {version.note && <p className="m-0 text-text-muted">{version.note}</p>}
                        <SsbjCopyableId value={version.id} label="版 ID" display={`版 ID ${version.id.slice(0, 8)}…`} />
                      </div>
                      <div className="flex flex-wrap items-start gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={busyVersionId !== null} onClick={() => void handleInspect(version.id)}>
                          内容を見る
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={busyVersionId !== null} onClick={() => void handleDownload(version.id, 'csv')}>
                          <Download size={14} /> {busyVersionId === version.id ? '処理中...' : 'CSVを出力'}
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={busyVersionId !== null} onClick={() => void handleDownload(version.id, 'xlsx')}>
                          <FileSpreadsheet size={14} /> {busyVersionId === version.id ? '処理中...' : 'Excelを出力'}
                        </Button>
                        {canEdit && (
                          // 項目を選ぶとメニューは閉じ、確認のダイアログを開く（ダイアログの後ろにメニューを開いたまま残さない）。
                          // メニューを閉じたあとにダイアログが開くので、メニューは modal にしない（閉じたメニューが画面の操作を止めたまま残らないように）。
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" size="sm" variant="outline" disabled={busyVersionId !== null}>
                                その他の操作 <ChevronDown size={14} aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-max">
                              <DropdownMenuItem disabled={busyVersionId !== null} onSelect={() => setPending({ kind: 'copy', versionId: version.id })}>
                                <Copy size={14} /> この版から新版を作成
                              </DropdownMenuItem>
                              {!locked && (
                                <DropdownMenuItem variant="destructive" disabled={busyVersionId !== null} onSelect={() => setPending({ kind: 'restore', versionId: version.id })}>
                                  <RotateCcw size={14} /> この版の内容に戻す
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            {/* 版どうしの比較は、作業中の内容を見られるロールだけ（閲覧者が読めるのは承認した版 1 つだけで、比べる相手が無い）。 */}
            {!viewerOnly && versions.length >= 2 && <SsbjVersionCompare reportId={reportId} versions={versions} />}
            {selectedVersion && (
              <Card>
                <SsbjVersionView
                  key={selectedVersion.id}
                  version={selectedVersion}
                  approved={report.review.approvedVersionId === selectedVersion.id}
                  viewerOnly={viewerOnly}
                />
              </Card>
            )}
            {/* 出力履歴は組織の全員の出力を読む（OGT 本体の記録）。閲覧者には出さない。 */}
            {!viewerOnly && (
              <Card>
                <h2 className="m-0 mb-3 text-base font-bold">出力履歴（直近20件）</h2>
                {history.length === 0 ? <p className="text-sm text-text-muted">出力履歴はありません。</p> : (
                  <ul className="m-0 list-none space-y-2 p-0 text-sm">
                    {history.map(item => (
                      <li key={item.id}>
                        {FORMAT_LABELS[item.format]} · 版 {item.versionNumber} · {new Date(item.createdAt).toLocaleString('ja-JP')} · {item.versionId}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </>
        ) : null}
      </div>
      <SsbjVersionActionDialog
        open={pending?.kind === 'copy'}
        title={`版 ${pendingVersion?.versionNumber ?? ''} から新版を作成`}
        description={<p className="m-0">この版の保存内容を新しい固定版として複製します。元の版と現在の作業中データは変更されません。</p>}
        confirmLabel="新版を作成"
        busyLabel="作成中..."
        isBusy={busyVersionId !== null}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />
      <SsbjVersionActionDialog
        open={pending?.kind === 'restore'}
        title={`作業中の内容を 版 ${pendingVersion?.versionNumber ?? ''} の内容に戻す`}
        description={(
          <>
            <p className="m-0">作業中の内容（基本情報・文章・判断・リスク・機会・時間軸の定義・根拠文書・OGT の採用値）を、この版の内容で置き換えます。</p>
            <p className="m-0">戻す前の作業中の内容は、新しい保存版として自動で残します（あとからその版に戻せます）。</p>
            <p className="m-0">ただし、文章の選択式テンプレートで選んだ内容は保存版に含めないため、戻すと消えます（自動で残す保存版にも残りません）。</p>
            <p className="m-0">この版を作った後に加わった項目は、この版に含まれていないため空になります。</p>
          </>
        )}
        confirmLabel="この版の内容に戻す"
        busyLabel="戻しています..."
        isBusy={busyVersionId !== null}
        onConfirm={() => void runPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};
