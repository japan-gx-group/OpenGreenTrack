'use client';

// CSV 取込の実行前確認。既存カスタム係数の更新は取り消せないため、上書き対象を挙げてから実行させる。
// 共有の CsvImportConfirmModal に渡す要約（追加件数・更新対象の名前）をここで組み立てる。

import { CsvImportConfirmModal } from '@/components/ui/CsvImportConfirmModal.client';
import type { FactorCsvImportController } from '../hooks/useFactorCsvImport';
import type { EmissionFactor } from '../services/factorService';

interface FactorCsvImportConfirmProps {
  csvImport: FactorCsvImportController;
  /** 更新対象の現在の名前を引くために使う */
  database: EmissionFactor[];
}

export const FactorCsvImportConfirm = ({ csvImport, database }: FactorCsvImportConfirmProps) => (
  <CsvImportConfirmModal
    entityLabel="排出係数"
    isRunning={csvImport.isImporting}
    onCancel={csvImport.cancelImport}
    onConfirm={csvImport.runImport}
    summary={
      csvImport.importPreview && {
        fileName: csvImport.importPreview.fileName,
        createCount: csvImport.importPreview.plan.creates.length,
        skipCount: csvImport.importPreview.plan.skipCount,
        errors: csvImport.importPreview.plan.errors,
        updates: csvImport.importPreview.plan.updates.map(update => {
          const current = database.find(factor => factor.id === update.targetId);
          const renamed = current && current.name !== update.factor.name;
          return {
            row: update.row,
            label: renamed
              ? `${current.name} → ${update.factor.name}`
              : current?.name ?? update.factor.name,
          };
        }),
      }
    }
  />
);
