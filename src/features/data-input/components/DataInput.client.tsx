'use client';

import { PageHeading } from '@/components/layout/PageHeading';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Pagination } from '@/components/ui/Pagination.client';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { usePagination } from '@/hooks/usePagination';
import { useToast } from '@/hooks/useToast';
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
  const entrySave = useActivityEntrySave({
    // 新しい行は先頭に入るため、追加分が見えるよう1ページ目へ戻す。
    onSaved: (record) => { prependManualHistory(record); pagination.resetPage(); },
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
            カテゴリに応じて排出係数の参照方式（供給事業者別 / 標準 / IDEA）をフォーム側で切り替える。 */}
        <ActivityEntryForm locations={manualEntryLocations} onSave={entrySave.save} />

        {/* History Table */}
        <section className="gt-card gt-card-table flex flex-col gap-4">
          <ActivityHistoryToolbar
            totalCount={history.length}
            isRefreshing={isRefreshingHistory}
            onRefresh={refreshManualHistory}
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

      <ActivityRecordEditModal editor={editor} locations={manualEntryLocations} />
    </>
  );
};
