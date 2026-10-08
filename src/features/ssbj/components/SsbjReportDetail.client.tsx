'use client';

// SSBJ レポートの詳細画面（/ssbj/[reportId]）。基本情報を表示・編集し、手動保存で保存版を作る。
// 存在しない・他組織のレポートは「見つかりません」を表示し、他組織のレポートの存在を示唆しない。
// 読込は useSsbjReport、編集フォームは useSsbjReportForm、保存版の作成は useSsbjVersionSave、
// 状態の変更（レビュー依頼・承認・差戻し）は SsbjReportStatusCard が持ち、ここは組み立てるだけ。
// 承認済みの間は基本情報を編集させない（DB も変更を止める）。

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Pencil } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Toast } from '@/components/ui/Toast.client';
import { useToast } from '@/hooks/useToast';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { useSsbjReportForm } from '../hooks/useSsbjReportForm';
import { useSsbjVersionSave } from '../hooks/useSsbjVersionSave';
import type { SsbjReportStatusChangeResult } from '../services/reportWorkflowClient';
import { updateSsbjReportBasicInfo } from '../services/reportService';
import { isSsbjReportLocked } from '../utils/reportStatus';
import { toSsbjReportFormValues } from '../utils/reportValidation';
import { SsbjEditConflictError } from '../utils/writeError';
import { SsbjLockedNotice } from './SsbjLockedNotice';
import { SsbjReportBasicInfo } from './SsbjReportBasicInfo';
import { SsbjReportContentsNav } from './SsbjReportContentsNav';
import { SsbjReportFormFields } from './SsbjReportFormFields.client';
import { SsbjReportStatusCard } from './SsbjReportStatusCard.client';
import { SsbjTrialNotice } from './SsbjTrialNotice';
import { SsbjVersionSaveCard } from './SsbjVersionSaveCard';

export const SsbjReportDetail = ({ reportId }: { reportId: string }) => {
  const { toast, showToast } = useToast();
  const { report, setReport, reload, isLoading, errorMessage, isNotFound } = useSsbjReport(reportId);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  // 編集を始めた時点の基本情報の版数。表示中のレポートを読み直しても、フォームの値の元になった版数で保存する
  // （読み直した版数で保存すると、フォームに残った古い値で他の画面の変更を上書きしてしまう）。
  const [editBaseRevision, setEditBaseRevision] = useState<number>(0);

  const form = useSsbjReportForm(async input => {
    try {
      const updated = await updateSsbjReportBasicInfo(reportId, editBaseRevision, input);
      setReport(updated);
    } catch (error) {
      // 他の画面で先に保存されていた: 入力中の値はフォームに残し、表示用のレポートだけ最新に読み直す
      // （キャンセルして編集し直すと、最新の内容から編集できる）。
      if (error instanceof SsbjEditConflictError) reload();
      throw error;
    }
    showToast('基本情報を保存しました', 'success');
  });

  const startEdit = () => {
    if (!report) return;
    form.reset(toSsbjReportFormValues(report));
    setEditBaseRevision(report.basicInfoRevision);
    setIsEditing(true);
  };

  const versionSave = useSsbjVersionSave(reportId);

  const handleSave = async (event: FormEvent) => {
    if (await form.submit(event)) {
      setIsEditing(false);
    }
  };

  const handleStatusChanged = (result: SsbjReportStatusChangeResult) => {
    reload();
    const message = result.status === 'approved'
      ? `承認しました（承認した内容を 版 ${result.approvedVersionNumber} として保存しました）`
      : result.status === 'in_review' ? 'レビューを依頼しました' : '作成中に戻しました';
    showToast(message, 'success');
  };

  const handleCreateVersion = async () => {
    if (!report) return;
    const version = await versionSave.save(report.draftRevision);
    if (version) {
      showToast(`版 ${version.versionNumber} として保存しました`, 'success');
    }
  };

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title={report ? report.title : 'SSBJレポート'}
        description="SSBJレポートの基本情報"
        // レポートの年度は作成時に決まり、ヘッダーの年度切替とは連動しないため年度セレクタを出さない。
        showFiscalYear={false}
        primaryAction={null}
      />

      <Toast toast={toast} />

      <div className="flex flex-col" style={{ gap: '14px' }}>
        <Link
          href="/ssbj"
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} /> SSBJレポート一覧へ戻る
        </Link>

        <SsbjTrialNotice />

        {errorMessage && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
            {errorMessage}
          </div>
        )}

        {isLoading ? (
          <Card>
            <LoadingIndicator label="SSBJレポートを読み込んでいます..." />
          </Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
            <p className="mt-2 text-sm text-text-muted">
              レポートが存在しないか、URLが正しくない可能性があります。
            </p>
            <Link href="/ssbj" className="gt-btn mt-6">
              SSBJレポート一覧へ戻る
            </Link>
          </Card>
        ) : report ? (
          <>
            <SsbjLockedNotice report={report} />
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="m-0 text-base font-bold">基本情報</h2>
                {!isEditing && !isSsbjReportLocked(report.review) && (
                  <Button type="button" variant="outline" size="sm" onClick={startEdit}>
                    <Pencil size={14} />
                    編集
                  </Button>
                )}
              </div>

              {isEditing ? (
                <form onSubmit={event => void handleSave(event)} className="flex flex-col gap-4">
                  <SsbjReportFormFields form={form} />
                  <p className="m-0 text-xs text-text-muted">
                    対象年度（{report.fiscalYearLabel}）は作成後に変更できません。
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={form.isSaving}
                      onClick={() => setIsEditing(false)}
                    >
                      キャンセル
                    </Button>
                    <Button type="submit" disabled={form.isSaving}>
                      {form.isSaving ? '保存中...' : '変更を保存'}
                    </Button>
                  </div>
                </form>
              ) : (
                <SsbjReportBasicInfo report={report} />
              )}
            </Card>
            <SsbjReportStatusCard report={report} disabled={isEditing} onChanged={handleStatusChanged} />
            <SsbjReportContentsNav reportId={report.id} />
            <SsbjVersionSaveCard
              isSaving={versionSave.isSaving}
              errorMessage={versionSave.errorMessage}
              disabled={isEditing}
              onSave={() => void handleCreateVersion()}
            />
          </>
        ) : null}
      </div>
    </div>
  );
};
