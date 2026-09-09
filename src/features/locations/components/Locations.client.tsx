'use client';

import { useRef } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { CsvImportErrorPanel } from '@/components/ui/CsvImportErrorPanel.client';
import { Pagination } from '@/components/ui/Pagination.client';
import { Toast } from '@/components/ui/Toast.client';
import { downloadCsv } from '@/lib/files/csv';
import { usePagination } from '@/hooks/usePagination';
import { useToast } from '@/hooks/useToast';
import {
  LOCATION_CSV_HEADERS,
  buildLocationCsvTemplateRows,
  locationToCsvRow,
} from '../services/locationCsvImport';
import { useLocationCsvImport } from '../hooks/useLocationCsvImport';
import { useLocationDatabase } from '../hooks/useLocationDatabase';
import { useLocationDelete } from '../hooks/useLocationDelete';
import { useLocationFilters } from '../hooks/useLocationFilters';
import { useLocationForm } from '../hooks/useLocationForm';
import { LocationCsvImportConfirm } from './LocationCsvImportConfirm.client';
import { LocationDeleteDialog } from './LocationDeleteDialog.client';
import { LocationFilterBar } from './LocationFilterBar.client';
import { LocationFormModal } from './LocationFormModal.client';
import { LocationRegionCards } from './LocationRegionCards.client';
import { LocationTable } from './LocationTable.client';
import { LocationToolbar } from './LocationToolbar.client';
import { LocationTypeChart } from './LocationTypeChart.client';

const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

export const Locations = () => {
  const { toast, showToast } = useToast();
  const { database, setDatabase, isLoading, hasFetchedOnce, dataVersion, reload } = useLocationDatabase(showToast);
  const filters = useLocationFilters(database);
  // 一覧を取り直したとき（初回・更新ボタン・CSV 取込後）は 1 ページ目へ戻す。
  const pagination = usePagination(filters.filteredData, 10, { resetKey: dataVersion });
  const form = useLocationForm(setDatabase, showToast);
  const locationDelete = useLocationDelete(setDatabase, showToast);
  const csvImport = useLocationCsvImport(database, reload, showToast);

  // 取得・保存中のローディング表示。絞り込み（filteredData）は純粋なクライアント処理なので立てない。
  const isBusy = isLoading || form.isSaving;

  // 行メニュー（⋮）から開いたモーダルを閉じたあとのフォーカス復帰先。一覧表が控え、各モーダルへ渡す。
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  // 適用中の絞り込み条件のピル。個別解除でも他のフィルター操作と同じく1ページ目へ戻す（解除で件数が変わるため）。
  const activeFilters = filters.activeFilters.map(filter => ({
    ...filter,
    onRemove: () => { filter.onRemove(); pagination.resetPage(); },
  }));

  const handleResetFilters = () => {
    filters.resetFilters();
    pagination.resetPage();
    showToast('フィルターをリセットしました', 'success');
  };

  // 新規追加モーダルを開く。
  const openAddModal = () => {
    // 直前に開いた行メニューの ⋮ が復帰先として残らないようにクリアする
    // （このボタン自体は永続するので、Modal 側の通常のフォーカス復帰で戻れる）。
    menuTriggerRef.current = null;
    form.openAdd();
  };

  // Dynamic CSV generator reflecting current filtered list output
  // インポートと同じ列構成で書き出す（編集して取り込み直すラウンドトリップ用）。
  // ID列は同名拠点があるときの更新対象の特定に使う。稼働状況は一覧・フォームと同じ値で、
  // CSVからも一括で変更できる。
  const handleExportCSV = () => {
    const rows = filters.filteredData.map(locationToCsvRow);

    downloadCsv(`locations_filtered.csv`, [[...LOCATION_CSV_HEADERS], ...rows]);

    showToast(`${filters.totalCount}件の拠点データをCSVエクスポートしました`, 'success');
  };

  const handleDownloadTemplate = () => {
    downloadCsv('locations_template.csv', buildLocationCsvTemplateRows());
    showToast('CSVテンプレートをダウンロードしました', 'success');
  };

  return (
    <>
      <div className="page-content gt-scroll" style={{ position: 'relative' }}>
        <PageHeading
          title="拠点"
          description="拠点ごとの排出量とデータ連携状況"
          showFiscalYear={false}
        />

        <Toast toast={toast} />

        {/* サマリーカードの代わりに、拠点種別構成（左）と地域別拠点分布（右）を最上部へ並べる。 */}
        <div className="grid grid-cols-1 lg:grid-cols-5" style={{ gap: '14px' }}>
          <LocationTypeChart database={database} />
          <LocationRegionCards
            database={database}
            selectedRegion={filters.selectedRegion}
            onSelectRegion={(region) => { filters.setSelectedRegion(region); pagination.resetPage(); }}
          />
        </div>

        {/* Main Content Card */}
        <section className="gt-card gt-card-table flex flex-col gap-4" style={{ marginTop: '14px' }}>
          <LocationToolbar
            onDownloadTemplate={handleDownloadTemplate}
            onExportCsv={handleExportCSV}
            onSelectImportFile={(file) => void csvImport.selectFile(file)}
            onCreate={openAddModal}
          />

          <CsvImportErrorPanel errors={csvImport.importErrors} onClose={csvImport.clearErrors} />

          {/* 絞り込みを変えたら 1 ページ目へ戻す（フック同士は依存させず、ここで組み合わせる） */}
          <LocationFilterBar filters={filters} activeFilters={activeFilters} onChange={pagination.resetPage} />

          <LocationTable
            rows={pagination.pageItems}
            totalCount={filters.totalCount}
            isBusy={isBusy}
            hasFetchedOnce={hasFetchedOnce}
            menuTriggerRef={menuTriggerRef}
            onResetFilters={handleResetFilters}
            onEdit={form.openEdit}
            onDelete={locationDelete.openDeleteModal}
          />

          {/* Paginated Footer */}
          {filters.totalCount > 0 && (
            <div className="mt-4">
              <Pagination
                label="拠点一覧"
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
        </section>
      </div>

      <LocationCsvImportConfirm csvImport={csvImport} database={database} />
      <LocationFormModal form={form} returnFocusRef={menuTriggerRef} />
      <LocationDeleteDialog locationDelete={locationDelete} returnFocusRef={menuTriggerRef} />
    </>
  );
};
