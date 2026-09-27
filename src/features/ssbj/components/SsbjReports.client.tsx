'use client';

// SSBJ レポートの一覧画面（/ssbj）。ヘッダーで選択中の年度のレポートを一覧し、新規作成できる。
// 一覧の読込は useSsbjReports、作成フォームは useSsbjReportForm が持ち、ここは組み立てるだけ。

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { FileCheck2, Plus } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Toast } from '@/components/ui/Toast.client';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { useToast } from '@/hooks/useToast';
import { useSsbjReportForm } from '../hooks/useSsbjReportForm';
import { useSsbjReports } from '../hooks/useSsbjReports';
import { createSsbjReport } from '../services/reportService';
import { SsbjReportCreateDialog } from './SsbjReportCreateDialog.client';
import { SsbjReportTable } from './SsbjReportTable';
import { SsbjTrialNotice } from './SsbjTrialNotice';

export const SsbjReports = () => {
  const { toast, showToast } = useToast();
  const { fiscalYearId, fiscalYears, isLoading: isFiscalYearLoading } = useFiscalYear();
  const selectedFiscalYear = fiscalYears.find(fiscalYear => fiscalYear.id === fiscalYearId) ?? null;
  // 年度が 1 件も無い（初期セットアップ直後など）。レポートは年度に結び付くため作成できない。
  const hasNoFiscalYear = !isFiscalYearLoading && fiscalYears.length === 0;

  const list = useSsbjReports(fiscalYearId, showToast);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);

  const form = useSsbjReportForm(async input => {
    if (!selectedFiscalYear) {
      throw new Error('算定年度を選択してください');
    }
    const created = await createSsbjReport(selectedFiscalYear.id, input);
    list.addReport(created);
    showToast('SSBJレポートを作成しました', 'success');
  });

  const openCreate = () => {
    form.reset();
    setIsCreateOpen(true);
  };

  const handleCreate = async (event: FormEvent) => {
    if (await form.submit(event)) {
      setIsCreateOpen(false);
    }
  };

  const isInitialLoading = !hasNoFiscalYear && (!list.hasFetchedOnce || isFiscalYearLoading);

  return (
    <>
      <div className="page-content gt-scroll relative">
        <PageHeading
          title="SSBJレポート"
          description="サステナビリティ関連財務開示（SSBJ）の下書きを年度ごとに作成します"
          primaryAction={
            <Button type="button" onClick={openCreate} disabled={!selectedFiscalYear}>
              <Plus size={15} strokeWidth={1.9} />
              新規作成
            </Button>
          }
        />

        <Toast toast={toast} />

        <div className="flex flex-col" style={{ gap: '14px' }}>
          <SsbjTrialNotice />

          {hasNoFiscalYear ? (
            <Card className="text-sm text-text-muted">
              <p className="m-0">算定年度が登録されていません。企業設定から年度を追加してください。</p>
              <Link href="/settings/company" className="gt-btn mt-4">
                企業設定へ
              </Link>
            </Card>
          ) : isInitialLoading ? (
            <Card>
              <LoadingIndicator label="SSBJレポートを読み込んでいます..." />
            </Card>
          ) : list.reports.length === 0 ? (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
              <p className="text-lg font-bold text-text-muted">
                {selectedFiscalYear?.label ?? '選択中の年度'}のSSBJレポートはまだありません
              </p>
              <p className="mt-2 text-sm text-text-muted">「新規作成」からレポートを作成してください。</p>
            </Card>
          ) : (
            <Card>
              <SsbjReportTable reports={list.reports} />
            </Card>
          )}
        </div>
      </div>

      <SsbjReportCreateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        fiscalYearLabel={selectedFiscalYear?.label ?? ''}
        form={form}
        onSubmit={event => void handleCreate(event)}
      />
    </>
  );
};
