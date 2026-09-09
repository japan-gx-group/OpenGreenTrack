'use client';

import { useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Pagination } from '@/components/ui/Pagination.client';
import { CsvImportErrorPanel } from '@/components/ui/CsvImportErrorPanel.client';
import { Toast } from '@/components/ui/Toast.client';
import { downloadCsv } from '@/lib/files/csv';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { usePagination } from '@/hooks/usePagination';
import { useToast } from '@/hooks/useToast';
import type { EmissionFactor } from '../services/factorService';
import { FACTOR_CSV_HEADERS, factorToCsvRow } from '../services/factorCsvImport';
import type { FactorGroup } from '../utils/factorGroups';
import { useFactorCsvImport } from '../hooks/useFactorCsvImport';
import { useFactorDatabase } from '../hooks/useFactorDatabase';
import { useFactorDelete } from '../hooks/useFactorDelete';
import { useFactorFilters } from '../hooks/useFactorFilters';
import { useFactorForm } from '../hooks/useFactorForm';
import { FactorCsvImportConfirm } from './FactorCsvImportConfirm.client';
import { FactorDeleteDialog } from './FactorDeleteDialog.client';
import { FactorDetailModal } from './FactorDetailModal';
import { FactorFilterBar } from './FactorFilterBar.client';
import { FactorFormModal } from './FactorFormModal.client';
import { FACTOR_TAB_PANEL_ID, FactorGroupTabs, factorTabId } from './FactorGroupTabs.client';
import { FactorHistoryCard } from './FactorHistoryCard.client';
import { FactorSourcesCard } from './FactorSourcesCard.client';
import { FactorTable } from './FactorTable.client';
import { FactorToolbar } from './FactorToolbar.client';
import { IdeaDatabaseCard } from './IdeaDatabaseCard.client';

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

export const Factors = () => {
  const { fiscalYear } = useFiscalYear();
  const { toast, showToast } = useToast();
  const { database, setDatabase, isLoading, loadFailed } = useFactorDatabase(showToast);
  const filters = useFactorFilters(database, fiscalYear);
  const pagination = usePagination(filters.filteredData, 10);

  // タブ切替。絞り込み解除（フック側）に加えて 1 ページ目へ戻す。
  const handleChangeGroup = (group: FactorGroup) => {
    if (group === filters.activeGroup) return;
    filters.changeGroup(group);
    pagination.resetPage();
  };

  const form = useFactorForm({
    activeGroup: filters.activeGroup,
    availableYears: filters.availableYears,
    fiscalYear,
    setDatabase,
    showToast,
    onSaved: handleChangeGroup,
  });
  const factorDelete = useFactorDelete(setDatabase, showToast);
  const csvImport = useFactorCsvImport(database, setDatabase, showToast);

  // 一覧の「クエリを実行中...」オーバーレイは、取得中だけでなく保存・CSV取込の書き込み中にも出す。
  const isBusy = isLoading || form.isSaving || csvImport.isImporting;

  // 行クリックで開く出典・算定式の詳細
  const [detailFactor, setDetailFactor] = useState<EmissionFactor | null>(null);

  const handleResetFilters = () => {
    filters.resetFilters();
    pagination.resetPage();
    showToast('フィルターをリセットしました', 'success');
  };

  // CSV Export reflecting current table filter output
  // 列の並びはインポート側（FACTOR_CSV_HEADERS / factorToCsvRow）に合わせる。
  // ここで独自に列を組み立てるとラウンドトリップが壊れるため、定義を借りてくる。
  // ヘッダーの「エネルギー種別」列は画面のタブ分割でも変えない。既に配布済みの
  // テンプレートと取込（factorCsvImport.ts のヘッダー検証）の互換を保つため。
  const handleExportCSV = () => {
    const rows = filters.filteredData.map(factorToCsvRow);

    downloadCsv(
      `emission_factors_${filters.activeGroup}_${filters.selectedYear}.csv`,
      [[...FACTOR_CSV_HEADERS], ...rows],
    );

    showToast(`${filters.totalCount}件のデータをCSVエクスポートしました`, 'success');
  };

  return (
    <>
      <div className="page-content gt-scroll" style={{ position: 'relative' }}>
        {/* 年度はカード内の「適用年度」フィルタで選ぶため、見出しの年度セレクタは出さない
            （同じ画面に年度の選択肢が2つ並ぶのを避ける）。
            フィルタの初期値・新規係数の既定年度は useFiscalYear() の値をそのまま使う。 */}
        <PageHeading
          title="排出係数"
          description="公的係数とカスタム係数の管理"
          showFiscalYear={false}
        />

        <Toast toast={toast} />

        {/* Main Content Card */}
        <section className="gt-card gt-card-table">
          <FactorToolbar
            displayCount={filters.totalCount}
            onResetFilters={handleResetFilters}
            onExportCsv={handleExportCSV}
            onSelectImportFile={(file) => void csvImport.selectFile(file)}
            onCreate={form.openCreate}
          />

          <FactorGroupTabs
            activeGroup={filters.activeGroup}
            groupCounts={filters.groupCounts}
            onChange={handleChangeGroup}
          />

          <CsvImportErrorPanel errors={csvImport.importErrors} onClose={csvImport.clearErrors} className="mb-2" />

          {/* タブで切り替わる中身（絞り込み・一覧・ページ送り）。パネルは 1 つで、
              中身だけが選択中のタブに応じて変わる（aria-labelledby も選択中のタブを指す）。 */}
          <div
            id={FACTOR_TAB_PANEL_ID}
            role="tabpanel"
            aria-labelledby={factorTabId(filters.activeGroup)}
          >
            {/* 絞り込みを変えたら 1 ページ目へ戻す（フック同士は依存させず、ここで組み合わせる） */}
            <FactorFilterBar filters={filters} onChange={pagination.resetPage} />

            <FactorTable
              rows={pagination.pageItems}
              totalCount={filters.totalCount}
              activeGroup={filters.activeGroup}
              isBusy={isBusy}
              onResetFilters={handleResetFilters}
              onSelect={setDetailFactor}
              onEdit={form.openEdit}
              onDelete={factorDelete.requestDelete}
            />

            {/* Pagination Controls */}
            {filters.totalCount > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <Pagination
                  label="排出係数マスタ"
                  totalCount={pagination.totalCount}
                  currentPage={pagination.currentPage}
                  totalPages={pagination.totalPages}
                  pageSize={pagination.pageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageChange={pagination.setPage}
                  // 表示件数を変えると同じページ番号でも中身が変わるため、1ページ目に戻す。
                  onPageSizeChange={pagination.setPageSize}
                />
              </div>
            )}
          </div>
        </section>

        {/* IDEAデータベース（BYOライセンス取込。設計書 §5.2） */}
        <div style={{ marginTop: '14px' }}>
          <IdeaDatabaseCard />
        </div>

        {/* Bottom Details (Sources & Logs) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: '14px', marginTop: '14px' }}>
          <FactorSourcesCard database={database} isBusy={isBusy} loadFailed={loadFailed} />
          <FactorHistoryCard database={database} />
        </div>
      </div>

      <FactorFormModal form={form} availableYears={filters.availableYears} />

      {detailFactor && (
        <FactorDetailModal factor={detailFactor} onClose={() => setDetailFactor(null)} />
      )}

      <FactorCsvImportConfirm csvImport={csvImport} database={database} />

      <FactorDeleteDialog factorDelete={factorDelete} />
    </>
  );
};
