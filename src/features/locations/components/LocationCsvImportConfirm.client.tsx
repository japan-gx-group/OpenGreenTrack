'use client';

// CSV 取込の実行前確認。既存拠点の更新は取り消せないため、上書き対象を挙げてから実行させる。
// 共有の CsvImportConfirmModal に渡す要約（追加件数・記入例の除外・更新対象の名前）をここで組み立てる。

import { CsvImportConfirmModal } from '@/components/ui/CsvImportConfirmModal.client';
import type { LocationCsvImportController } from '../hooks/useLocationCsvImport';
import { LOCATION_CSV_EXAMPLE_PREFIX } from '../services/locationCsvImport';
import type { LocationRecord } from '../types';

interface LocationCsvImportConfirmProps {
  csvImport: LocationCsvImportController;
  /** 更新対象の現在の名前を引くために使う */
  database: LocationRecord[];
}

export const LocationCsvImportConfirm = ({ csvImport, database }: LocationCsvImportConfirmProps) => (
  <CsvImportConfirmModal
    entityLabel="拠点"
    isRunning={csvImport.isImporting}
    onCancel={csvImport.cancelImport}
    onConfirm={csvImport.runImport}
    summary={
      csvImport.importPreview && {
        fileName: csvImport.importPreview.fileName,
        createCount: csvImport.importPreview.plan.creates.length,
        skipCount: csvImport.importPreview.plan.skipCount,
        errors: csvImport.importPreview.plan.errors,
        notes:
          csvImport.importPreview.plan.exampleRowCount > 0
            ? [`拠点名が「${LOCATION_CSV_EXAMPLE_PREFIX}」で始まる記入例の行 ${csvImport.importPreview.plan.exampleRowCount} 件は取り込まずに除外します。`]
            : undefined,
        updates: csvImport.importPreview.plan.updates.map(update => {
          const current = database.find(location => location.id === update.targetId);
          const renamed = current && current.name !== update.location.name;
          return {
            row: update.row,
            label: renamed
              ? `${current.name} → ${update.location.name}`
              : current?.name ?? update.location.name,
          };
        }),
      }
    }
  />
);
