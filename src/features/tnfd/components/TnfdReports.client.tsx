'use client';

// TNFD レポートの一覧画面（/tnfd）。ヘッダーで選択中の年度のレポートを一覧し、新規作成できる。
// 一覧の読込は useTnfdReports、作成フォームは useTnfdReportForm が持ち、ここは組み立てるだけ。

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Leaf, Plus } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Toast } from '@/components/ui/Toast.client';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { useToast } from '@/hooks/useToast';
import { useTnfdReportForm } from '../hooks/useTnfdReportForm';
import { useTnfdReports } from '../hooks/useTnfdReports';
import { createTnfdReport } from '../services/reportService';
import { TnfdReportCreateDialog } from './TnfdReportCreateDialog.client';
import { TnfdReportTable } from './TnfdReportTable';
import { TnfdTrialNotice } from './TnfdTrialNotice';

export const TnfdReports = () => {
  const { toast, showToast } = useToast();
  const { fiscalYearId, fiscalYears, isLoading: isFiscalYearLoading } = useFiscalYear();
  const selectedFiscalYear = fiscalYears.find(fiscalYear => fiscalYear.id === fiscalYearId) ?? null;
  // 年度が 1 件も無い（初期セットアップ直後など）。レポートは年度に結び付くため作成できない。
  const hasNoFiscalYear = !isFiscalYearLoading && fiscalYears.length === 0;

  const list = useTnfdReports(fiscalYearId, showToast);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);

  const form = useTnfdReportForm(async input => {
    if (!selectedFiscalYear) {
      throw new Error('算定年度を選択してください');
    }
    const created = await createTnfdReport(selectedFiscalYear.id, input);
    list.addReport(created);
    showToast('TNFDレポートを作成しました', 'success');
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
          title="TNFDレポート"
          description="自然関連財務情報開示（TNFD）の下書きを年度ごとに作成します"
          primaryAction={
            <Button type="button" onClick={openCreate} disabled={!selectedFiscalYear}>
              <Plus size={15} strokeWidth={1.9} />
              新規作成
            </Button>
          }
        />

        <Toast toast={toast} />

        <div className="flex flex-col" style={{ gap: '14px' }}>
          <TnfdTrialNotice />

          {hasNoFiscalYear ? (
            <Card className="text-sm text-text-muted">
              <p className="m-0">算定年度が登録されていません。企業設定から年度を追加してください。</p>
              <Link href="/settings/company" className="gt-btn mt-4">
                企業設定へ
              </Link>
            </Card>
          ) : isInitialLoading ? (
            <Card>
              <LoadingIndicator label="TNFDレポートを読み込んでいます..." />
            </Card>
          ) : list.reports.length === 0 ? (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <Leaf aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
              <p className="text-lg font-bold text-text-muted">
                {selectedFiscalYear?.label ?? '選択中の年度'}のTNFDレポートはまだありません
              </p>
              <p className="mt-2 text-sm text-text-muted">「新規作成」からレポートを作成してください。</p>
            </Card>
          ) : (
            <Card>
              <TnfdReportTable reports={list.reports} />
            </Card>
          )}
        </div>
      </div>

      <TnfdReportCreateDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        fiscalYearLabel={selectedFiscalYear?.label ?? ''}
        form={form}
        onSubmit={event => void handleCreate(event)}
      />
    </>
  );
};
