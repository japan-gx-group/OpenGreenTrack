'use client';

// SSBJ レポートのリスク・機会画面（/ssbj/[reportId]/risks）。複数のリスク・機会を登録・編集・削除し、
// リスクの種類・説明・時間軸・章 / 項目への関連を持たせる。あわせてレポートとしての時間軸の定義を編集する。
// 変更は作業中の内容で、保存版はレポート詳細の手動保存で作る。
// 存在しない・他組織のレポートは「見つかりません」を表示し、他組織のレポートの存在を示唆しない。
// 読込は useSsbjReport / useSsbjRisksOpportunities / useSsbjTimeHorizons、入力は useSsbjRiskOpportunityForm /
// useSsbjTimeHorizonForm、削除は useSsbjRiskOpportunityDelete が持ち、ここは組み立てるだけ。

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Plus } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Toast } from '@/components/ui/Toast.client';
import { useToast } from '@/hooks/useToast';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { useSsbjRiskOpportunityDelete } from '../hooks/useSsbjRiskOpportunityDelete';
import { useSsbjRiskOpportunityForm } from '../hooks/useSsbjRiskOpportunityForm';
import { useSsbjRisksOpportunities } from '../hooks/useSsbjRisksOpportunities';
import { useSsbjTimeHorizonForm } from '../hooks/useSsbjTimeHorizonForm';
import { useSsbjTimeHorizons } from '../hooks/useSsbjTimeHorizons';
import { createSsbjRiskOpportunity, updateSsbjRiskOpportunity } from '../services/riskOpportunityService';
import { saveSsbjTimeHorizons } from '../services/timeHorizonService';
import type { SsbjRiskOpportunity } from '../types';
import { toSsbjRiskOpportunityFormValues } from '../utils/riskOpportunity';
import { SsbjRiskOpportunityDeleteDialog } from './SsbjRiskOpportunityDeleteDialog.client';
import { SsbjRiskOpportunityDialog } from './SsbjRiskOpportunityDialog.client';
import { SsbjRiskOpportunityList } from './SsbjRiskOpportunityList';
import { SsbjTimeHorizonCard } from './SsbjTimeHorizonCard.client';
import { SsbjTrialNotice } from './SsbjTrialNotice';

export const SsbjRisksOpportunities = ({ reportId }: { reportId: string }) => {
  const { toast, showToast } = useToast();
  const { report, isLoading: isReportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const list = useSsbjRisksOpportunities(reportId, report !== null);
  // null: ダイアログを閉じている / 'new': 登録 / それ以外: 編集中の対象
  const [editing, setEditing] = useState<SsbjRiskOpportunity | 'new' | null>(null);
  const deletion = useSsbjRiskOpportunityDelete();
  const horizons = useSsbjTimeHorizons(reportId, report !== null);
  const [isEditingHorizons, setIsEditingHorizons] = useState<boolean>(false);

  const horizonForm = useSsbjTimeHorizonForm(async input => {
    if (!report) return;
    horizons.setDefinitions(await saveSsbjTimeHorizons(report, input));
    showToast('時間軸の定義を保存しました', 'success');
  });

  const startEditHorizons = () => {
    horizonForm.reset(horizons.definitions);
    setIsEditingHorizons(true);
  };

  const handleSaveHorizons = async (event: FormEvent) => {
    if (await horizonForm.submit(event)) {
      setIsEditingHorizons(false);
    }
  };

  const form = useSsbjRiskOpportunityForm(async input => {
    if (!report) return;
    const saved =
      editing && editing !== 'new'
        ? await updateSsbjRiskOpportunity(editing.id, input)
        : await createSsbjRiskOpportunity(report, input);
    list.upsertItem(saved);
    showToast(editing === 'new' ? 'リスク・機会を登録しました' : 'リスク・機会を保存しました', 'success');
  });

  const openCreate = () => {
    form.reset();
    setEditing('new');
  };

  const openEdit = (item: SsbjRiskOpportunity) => {
    form.reset(toSsbjRiskOpportunityFormValues(item));
    setEditing(item);
  };

  const handleSubmit = async (event: FormEvent) => {
    if (await form.submit(event)) {
      setEditing(null);
    }
  };

  const handleDelete = async () => {
    const deletedId = await deletion.confirm();
    if (deletedId) {
      list.removeItem(deletedId);
      showToast('リスク・機会を削除しました', 'success');
    }
  };

  const errorMessage = reportError || list.errorMessage || horizons.errorMessage;
  const isLoading = isReportLoading || (report !== null && (list.isLoading || horizons.isLoading));

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title="リスク・機会"
        description={report ? report.title : 'SSBJレポートのリスク・機会'}
        showFiscalYear={false}
        primaryAction={
          report ? (
            <Button type="button" onClick={openCreate}>
              <Plus size={16} />
              リスク・機会を追加
            </Button>
          ) : null
        }
      />

      <Toast toast={toast} />

      <div className="flex flex-col" style={{ gap: '14px' }}>
        <Link
          href={`/ssbj/${encodeURIComponent(reportId)}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>

        <SsbjTrialNotice />

        {errorMessage && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
            {errorMessage}
          </div>
        )}

        {isLoading ? (
          <Card>
            <LoadingIndicator label="リスク・機会を読み込んでいます..." />
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
        ) : report && !list.errorMessage && !horizons.errorMessage ? (
          <>
            <SsbjTimeHorizonCard
              definitions={horizons.definitions}
              isEditing={isEditingHorizons}
              form={horizonForm}
              onStartEdit={startEditHorizons}
              onCancel={() => setIsEditingHorizons(false)}
              onSubmit={event => void handleSaveHorizons(event)}
            />
            <Card>
              <h2 className="m-0 mb-4 text-base font-bold">登録済みのリスク・機会（{list.items.length}件）</h2>
              <SsbjRiskOpportunityList items={list.items} onEdit={openEdit} onDelete={deletion.request} />
            </Card>
          </>
        ) : null}
      </div>

      <SsbjRiskOpportunityDialog
        open={editing !== null}
        mode={editing === 'new' ? 'create' : 'edit'}
        onOpenChange={open => !open && setEditing(null)}
        form={form}
        onSubmit={event => void handleSubmit(event)}
      />
      <SsbjRiskOpportunityDeleteDialog controller={deletion} onConfirm={() => void handleDelete()} />
    </div>
  );
};
