'use client';

// CSVインポート（エクスポートと同じ列構成のラウンドトリップ）。
// 追加・更新の判定は buildLocationImportPlan（純関数）が行い、DBには触れない。
// ファイル選択では解析結果を確認モーダルへ渡すだけで、書き込みは runImport が行う。

import { useState } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import { addLocations, updateLocations } from '../services/locationService';
import {
  buildLocationImportPlan,
  decodeLocationCsvBuffer,
  type LocationImportPlan,
  type LocationImportRowError,
} from '../services/locationCsvImport';
import type { LocationRecord } from '../types';

export interface LocationImportPreview {
  fileName: string;
  plan: LocationImportPlan;
}

export interface LocationCsvImportController {
  /** 行単位エラー（行番号つきでパネル表示する。トーストでは件数のみ通知） */
  importErrors: LocationImportRowError[];
  clearErrors: () => void;
  /**
   * 取込内容の確認（実行前）。取込は既存拠点の更新を含み取り消せないため、
   * DBへ書く前に「何件追加され、どの拠点が更新されるか」を必ず見せる。
   */
  importPreview: LocationImportPreview | null;
  isImporting: boolean;
  selectFile: (file: File) => Promise<void>;
  cancelImport: () => void;
  runImport: () => Promise<void>;
}

export function useLocationCsvImport(
  database: LocationRecord[],
  /** 取込後に一覧を取り直す（採番された ID と更新後の値を反映するため）。失敗は throw する */
  reload: () => Promise<void>,
  showToast: ShowToast,
): LocationCsvImportController {
  const [importErrors, setImportErrors] = useState<LocationImportRowError[]>([]);
  const [importPreview, setImportPreview] = useState<LocationImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const selectFile = async (file: File) => {
    setImportErrors([]);
    try {
      const text = decodeLocationCsvBuffer(await file.arrayBuffer());
      setImportPreview({ fileName: file.name, plan: buildLocationImportPlan(text, database) });
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'CSVファイルを読み取れませんでした', 'error');
    }
  };

  // 確認モーダルで承認された取込プランをDBへ反映する。
  const runImport = async () => {
    if (!importPreview) return;
    const { plan } = importPreview;
    setIsImporting(true);
    try {
      // 行ごとに addLocation / updateLocation を呼ぶと、テンプレートが想定する規模
      // （数百行）で往復回数が現実的でなくなるため、一括版を使う。
      // 失敗は添字で返るので、行番号つきのエラーへ戻す。
      const createResult = await addLocations(plan.creates.map(create => create.location));
      const updateResult = await updateLocations(
        plan.updates.map(update => ({ id: update.targetId, location: update.location })),
      );

      const addedCount = createResult.created.length;
      const updatedCount = updateResult.updated.length;
      const runtimeErrors: LocationImportRowError[] = [
        ...createResult.failures.map(failure => ({
          row: plan.creates[failure.index].row,
          reasons: [failure.message],
        })),
        ...updateResult.failures.map(failure => ({
          row: plan.updates[failure.index].row,
          reasons: [failure.message],
        })),
      ];

      // 書き込みはここまでで確定している（行ごとに実行するため部分的に反映され得る）。
      // 結果の通知を先に済ませ、この後の再取得が失敗しても「どの行が失敗したか」を失わない。
      const allErrors = [...plan.errors, ...runtimeErrors].sort((a, b) => a.row - b.row);
      setImportErrors(allErrors);
      // 記入例行はエラーでもスキップでもないので、除外したときだけ末尾に添える
      const exampleNote = plan.exampleRowCount > 0 ? `・記入例${plan.exampleRowCount}件を除外` : '';
      showToast(
        `CSVインポート完了: 追加${addedCount}件・更新${updatedCount}件・スキップ${plan.skipCount}件・エラー${allErrors.length}件${exampleNote}`,
        allErrors.length > 0 ? 'error' : 'success',
      );

      // 1件でも反映されたら一覧を取り直す（採番されたIDと更新後の値を表示に反映するため）。
      // 取込自体は成功しているため、再取得の失敗を取込の失敗として通知しない。
      if (addedCount > 0 || updatedCount > 0) {
        try {
          await reload();
        } catch {
          showToast('取込は完了しましたが、一覧の再取得に失敗しました。画面を再読み込みしてください。', 'error');
        }
      }
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'CSVインポートに失敗しました', 'error');
    } finally {
      setIsImporting(false);
      setImportPreview(null);
    }
  };

  return {
    importErrors,
    clearErrors: () => setImportErrors([]),
    importPreview,
    isImporting,
    selectFile,
    cancelImport: () => setImportPreview(null),
    runImport,
  };
}
