'use client';

// SSBJ レポートの詳細画面（/ssbj/[reportId]）。基本情報を表示し、編集できる。
// 存在しない・他組織のレポートは「見つかりません」を表示し、他組織のレポートの存在を示唆しない。
// 読込は useSsbjReport、編集フォームは useSsbjReportForm が持ち、ここは組み立てるだけ。

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
import { updateSsbjReportBasicInfo } from '../services/reportService';
import { toSsbjReportFormValues } from '../utils/reportValidation';
import { SsbjReportBasicInfo } from './SsbjReportBasicInfo';
import { SsbjReportFormFields } from './SsbjReportFormFields.client';
import { SsbjTrialNotice } from './SsbjTrialNotice';

export const SsbjReportDetail = ({ reportId }: { reportId: string }) => {
  const { toast, showToast } = useToast();
  const { report, setReport, isLoading, errorMessage, isNotFound } = useSsbjReport(reportId);
  const [isEditing, setIsEditing] = useState<boolean>(false);

  const form = useSsbjReportForm(async input => {
    const updated = await updateSsbjReportBasicInfo(reportId, input);
    setReport(updated);
    showToast('基本情報を保存しました', 'success');
  });

  const startEdit = () => {
    if (!report) return;
    form.reset(toSsbjReportFormValues(report));
    setIsEditing(true);
  };

  const handleSave = async (event: FormEvent) => {
    if (await form.submit(event)) {
      setIsEditing(false);
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
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="m-0 text-base font-bold">基本情報</h2>
              {!isEditing && (
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
        ) : null}
      </div>
    </div>
  );
};
