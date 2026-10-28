'use client';

import { useMemo, useRef, useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Pagination } from '@/components/ui/Pagination.client';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { usePagination } from '@/hooks/usePagination';
import { useToast } from '@/hooks/useToast';
import { InvoiceReadingCard } from '@/features/invoice-reading/components/InvoiceReadingCard.client';
import { EvidenceListModal } from '@/features/activity-evidence/components/EvidenceListModal.client';
import type { ActivityEntryPrefill } from '../types';
import { useActivityCalculation } from '../hooks/useActivityCalculation';
import { useActivityEntrySave } from '../hooks/useActivityEntrySave';
import { useActivityHistory } from '../hooks/useActivityHistory';
import { useActivityRecordEditor } from '../hooks/useActivityRecordEditor';
import { useHistoryFilters } from '../hooks/useHistoryFilters';
import { useProvisionalRecalculation } from '../hooks/useProvisionalRecalculation';
import { ActivityEntryForm } from './ActivityEntryForm.client';
import { ActivityHistoryFilterBar } from './ActivityHistoryFilterBar.client';
import { ActivityHistoryTable } from './ActivityHistoryTable.client';
import { ActivityHistoryToolbar } from './ActivityHistoryToolbar.client';
import { ActivityRecordEditModal } from './ActivityRecordEditModal.client';
import { CalculationStatusBanner } from './CalculationStatusBanner.client';
import { DATA_INPUT_TOAST_VISIBLE_MS, DataInputToast } from './DataInputToast.client';
import { ProvisionalRecalculationBanner } from './ProvisionalRecalculationBanner.client';

const HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_HISTORY_PAGE_SIZE = HISTORY_PAGE_SIZE_OPTIONS[0];

export const DataInput = () => {
  // profile は保存後の自動計算（/api/calculations）に渡す organizationId の取得に使う。
  const { profile } = useCurrentUser();
  // 年度セレクタは非表示（showFiscalYear=false）で、保存後の自動計算はレコードの年月から
  // 年度を導出する。そのためコンテキストからは会計年度マスタだけを使う。
  const { fiscalYears } = useFiscalYear();
  // 算定結果の通知は複数行になるため、他画面より長く出す。
  const { toast, showToast } = useToast({ durationMs: DATA_INPUT_TOAST_VISIBLE_MS });

  const {
    history,
    manualEntryLocations,
    isRefreshing: isRefreshingHistory,
    refresh: refreshManualHistory,
    prepend: prependManualHistory,
    adjustEvidenceCount,
    uncalculatedItems,
  } = useActivityHistory(showToast);
  const historyFilters = useHistoryFilters(history);
  // 入力履歴のページネーション。検索・フィルターの絞り込みを先に適用し、その結果に対してページングする。
  const pagination = usePagination(historyFilters.filteredHistory, DEFAULT_HISTORY_PAGE_SIZE);
  const historyStartIndex = pagination.totalCount === 0
    ? 0
    : (pagination.currentPage - 1) * pagination.pageSize + 1;
  const historyEndIndex = Math.min(pagination.currentPage * pagination.pageSize, pagination.totalCount);

  // 絞り込みを消したときも 1 ページ目へ戻す（フック同士は依存させず、ここで組み合わせる）。
  const clearHistoryFilters = () => {
    historyFilters.clearFilters();
    pagination.resetPage();
  };

  const calculation = useActivityCalculation({
    organizationId: profile?.organizationId ?? null,
    fiscalYears,
    uncalculatedItems,
    refreshHistory: refreshManualHistory,
    showToast,
  });
  const provisional = useProvisionalRecalculation({
    runCalculationNow: calculation.runNow,
    refreshHistory: refreshManualHistory,
    showToast,
  });
  const editor = useActivityRecordEditor({
    fiscalYears,
    runAutoCalculation: calculation.runAutoCalculation,
    refreshHistory: refreshManualHistory,
    showToast,
  });
  // 重複事前警告と一括入力の「登録済みの月」の照合用に、履歴行から元レコード（表示用整形を挟まない）を
  // 取り出して両フォームへ渡す。
  const historyRecords = useMemo(
    () => history.flatMap((item) => (item.record ? [item.record] : [])),
    [history],
  );
  // 請求書の読取りの「フォームで開く」。フォームは初期値として読むだけなので、key を替えて作り直す。
  // 保存に成功したら案内（どこから入れた値か）だけを消し、key は替えない（拠点・カテゴリの保持を崩さない）。
  const [entryFormKey, setEntryFormKey] = useState(0);
  const [entryPrefill, setEntryPrefill] = useState<ActivityEntryPrefill | undefined>(undefined);
  const entryFormRef = useRef<HTMLDivElement>(null);
  const [isEvidenceListOpen, setIsEvidenceListOpen] = useState(false);
  // 新規入力フォームに並べている（まだ記録に紐づけていない）帳票。「帳票の一覧」で削除させない。
  const [pendingEvidenceIds, setPendingEvidenceIds] = useState<string[]>([]);
  const applyPrefill = (prefill: ActivityEntryPrefill) => {
    setEntryPrefill(prefill);
    setEntryFormKey((key) => key + 1);
    entryFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const entrySave = useActivityEntrySave({
    // 新しい行は先頭に入るため、追加分が見えるよう1ページ目へ戻す。
    onSaved: (record) => { prependManualHistory(record); pagination.resetPage(); },
    // 一括保存は履歴の再取得（saveBulk 内）で反映されるため、ページだけ戻す。
    onBulkSaved: () => pagination.resetPage(),
    runAutoCalculation: calculation.runAutoCalculation,
    refreshHistory: refreshManualHistory,
    showToast,
  });

  return (
    <>
      <div className="page-content gt-scroll" style={{ paddingBottom: '80px' }}>
        {/* 年月はフォーム側で入力するため、年度セレクタはこの画面では表示しない。 */}
        <PageHeading
          title="データ入力"
          description="活動量の登録と入力履歴"
          showFiscalYear={false}
        />

        <div className="flex flex-col" style={{ gap: '14px' }}>
        {/* Scope 1・2 と Scope 3 積上げ（IDEA連携）を 1 つのフォームで入力する。
            カテゴリに応じて排出係数の参照方式（供給事業者別 / 標準 / IDEA）をフォーム側で切り替える。
            複数月まとめて入力（一括入力）は履歴全件と照合して登録済みの月を表示する。 */}
        {/* 請求書（電気・都市ガス・燃料）の AI 読取り。読み取った明細は表でまとめて登録するか、「フォームで開く」で下のフォームに入る。 */}
        <InvoiceReadingCard
          locations={manualEntryLocations}
          historyRecords={historyRecords}
          onApply={applyPrefill}
          onSaveRows={entrySave.saveMany}
        />

        <div ref={entryFormRef} className="scroll-mt-4">
          <ActivityEntryForm
            key={entryFormKey}
            locations={manualEntryLocations}
            onSave={async (entry, options) => {
              await entrySave.save(entry, options);
              setEntryPrefill(undefined);
            }}
            onSaveBulk={entrySave.saveBulk}
            onPendingEvidenceChange={setPendingEvidenceIds}
            historyRecords={historyRecords}
            // 事前警告の「既存のレコードを開く」から編集モーダルを開き、合算入力へ直行できるようにする。
            onOpenDuplicateRecord={editor.open}
            prefill={entryPrefill}
          />
        </div>

        {/* History Table */}
        <section className="gt-card gt-card-table flex flex-col gap-4">
          <ActivityHistoryToolbar
            totalCount={history.length}
            isRefreshing={isRefreshingHistory}
            onRefresh={refreshManualHistory}
            onOpenEvidenceList={() => setIsEvidenceListOpen(true)}
          />

          <CalculationStatusBanner
            calculation={calculation}
            uncalculatedCount={uncalculatedItems.length}
            isRefreshingHistory={isRefreshingHistory}
          />

          <ProvisionalRecalculationBanner
            provisional={provisional}
            disabled={calculation.isRunning || calculation.isRecalculating || isRefreshingHistory}
          />

          {/* 絞り込みを変えたら 1 ページ目へ戻す */}
          {history.length > 0 && (
            <ActivityHistoryFilterBar
              filters={historyFilters}
              onChange={pagination.resetPage}
              onClear={clearHistoryFilters}
            />
          )}

          <ActivityHistoryTable
            rows={pagination.pageItems}
            totalCount={history.length}
            filteredCount={historyFilters.filteredHistory.length}
            hasActiveFilters={historyFilters.hasActiveFilters}
            onClearFilters={clearHistoryFilters}
            onSelect={editor.open}
          />

          {pagination.totalCount > 0 && (
            <Pagination
              label="入力履歴"
              totalCount={pagination.totalCount}
              currentPage={pagination.currentPage}
              totalPages={pagination.totalPages}
              pageSize={pagination.pageSize}
              pageSizeOptions={HISTORY_PAGE_SIZE_OPTIONS}
              // 絞り込み中は「全体の件数」と「該当件数」がずれるため、両方を出す。
              summary={
                historyFilters.hasActiveFilters
                  ? `全 ${history.length}件中 ${pagination.totalCount}件が該当（${historyStartIndex}-${historyEndIndex} 件を表示）`
                  : undefined
              }
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
            />
          )}
        </section>
        </div>

      </div>

      <DataInputToast message={toast?.message ?? null} />

      <ActivityRecordEditModal
        editor={editor}
        locations={manualEntryLocations}
        historyRecords={historyRecords}
        // 編集で帳票を足す・外すと、入力履歴の帳票の数をその場で直す（帳票 1 件ごとに一覧を取り直さない）。
        onEvidenceChange={adjustEvidenceCount}
      />

      <EvidenceListModal
        isOpen={isEvidenceListOpen}
        onClose={() => setIsEvidenceListOpen(false)}
        pendingFileIds={pendingEvidenceIds}
      />
    </>
  );
};
