'use client';

// 入力履歴の行クリックで開く編集モーダルの状態と、1 レコードの更新・削除。
// 統合フォーム（ActivityEntryForm）を edit モードで流用し、初期値はレコードから組み立てる。

import { useMemo, useState } from 'react';
import type { FiscalYearOption } from '@/contexts/fiscalYearContextValue';
import type { ShowToast } from '@/hooks/useToast';
import { refreshDashboardAggregates } from '@/features/scope-analysis/services/scope3MethodService';
import {
  deleteActivityRecord,
  updateManualActivityRecord,
  updateScope3ActivityRecord,
} from '../services/activityRecordService';
import { toActivityEntryInitialValues } from '../services/entryCategory';
import { findFiscalYearForDate } from '../services/inlineCalculation';
import type {
  ActivityEntryInitialValues,
  ActivityEntryInput,
  ManualActivityRecordInput,
  SavedManualActivityRecord,
  Scope3ActivityRecordInput,
} from '../types';

/** 編集で保存経路（Scope1/2 ⇄ Scope3積上げ）をまたいだ保存を拒否するときの文言（サービスに更新経路が無い）。 */
const ENTRY_PATH_MISMATCH_MESSAGE = '登録済みの記録は Scope 1・2 と Scope 3 積上げをまたいで変更できません。';

export interface UseActivityRecordEditorParams {
  fiscalYears: FiscalYearOption[];
  /** 値の変更後に旧年度・新年度を再算定する */
  runAutoCalculation: (periodStarts: string[]) => Promise<string[]>;
  refreshHistory: () => Promise<void>;
  showToast: ShowToast;
}

export interface ActivityRecordEditor {
  /** 編集中のレコード（null = モーダル非表示） */
  editingRecord: SavedManualActivityRecord | null;
  /** 編集モーダルの初期値。editingRecord ごとに 1 回だけ組み立て、毎レンダー新しいオブジェクトを渡さない */
  initialValues: ActivityEntryInitialValues | null;
  isDeleting: boolean;
  open: (record: SavedManualActivityRecord) => void;
  close: () => void;
  save: (entry: ActivityEntryInput) => Promise<void>;
  deleteRecord: () => Promise<void>;
}

export function useActivityRecordEditor({
  fiscalYears,
  runAutoCalculation,
  refreshHistory,
  showToast,
}: UseActivityRecordEditorParams): ActivityRecordEditor {
  const [editingRecord, setEditingRecord] = useState<SavedManualActivityRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const initialValues = useMemo(
    () => (editingRecord ? toActivityEntryInitialValues(editingRecord) : null),
    [editingRecord],
  );

  // 削除後は算定バッチではなく集計の再計算だけを呼ぶ。削除で消えた排出量の反映に算定は不要で、
  // レート制限のある /api/calculations を経由すると 429 のときに削除済みレコードの排出量が
  // ダッシュボードに残り続けるため。/api/dashboard-aggregates/refresh には件数制限が無い。
  // 年度が未登録の期間は集計行も存在しないため何もしない。
  const refreshAggregatesForPeriod = async (periodStart: string): Promise<string[]> => {
    const fiscalYear = findFiscalYearForDate(fiscalYears, periodStart);
    if (!fiscalYear) {
      return [];
    }
    try {
      await refreshDashboardAggregates(fiscalYear.id);
      return [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'ダッシュボード集計の更新に失敗しました';
      // 集計は次の算定バッチ（run_calculation_commit）でも絶対値から再計算されるため、放置しても自然に直る。
      return [`削除は完了しましたが、ダッシュボード集計の更新に失敗しました（${detail}）。次回の排出量計算時に自動で最新化されます。`];
    }
  };

  // 入力履歴の1レコードを編集保存する。値の変更後は再算定が必要なため、
  // 旧年度・新年度の両方（対象月を別年度へ動かした場合に備える）を /api/calculations で再算定する。
  const saveManual = async (input: ManualActivityRecordInput) => {
    if (!editingRecord) return;
    const oldPeriodStart = editingRecord.periodStart;
    await updateManualActivityRecord(editingRecord.id, input);
    const calcMessages = await runAutoCalculation([oldPeriodStart, input.periodStart]);
    await refreshHistory();
    showToast(['活動量を更新しました。', ...calcMessages].join('\n'), 'success');
  };

  // Scope3積上げレコードの編集保存。手動入力の編集（saveManual）と同じ再算定導線。
  const saveScope3 = async (input: Scope3ActivityRecordInput) => {
    if (!editingRecord) return;
    const oldPeriodStart = editingRecord.periodStart;
    await updateScope3ActivityRecord(editingRecord.id, input);
    const calcMessages = await runAutoCalculation([oldPeriodStart, input.periodStart]);
    await refreshHistory();
    showToast(['Scope3積上げデータを更新しました。', ...calcMessages].join('\n'), 'success');
  };

  const save = async (entry: ActivityEntryInput) => {
    if (!editingRecord) return;
    // フォーム側でも経路をまたぐカテゴリ変更は受け付けないが、保存直前にも照合して誤更新を防ぐ。
    const isScope3Record = editingRecord.energyType === 'scope3_activity';
    if ((entry.kind === 'scope3') !== isScope3Record) {
      throw new Error(ENTRY_PATH_MISMATCH_MESSAGE);
    }
    return entry.kind === 'scope3' ? saveScope3(entry.input) : saveManual(entry.input);
  };

  // 入力履歴の1レコードを削除する。emission_results はカスケード削除され、集計は削除直後の
  // refresh_dashboard_aggregates（/api/dashboard-aggregates/refresh）で追従する。
  // Scope3積上げレコードの削除もこの導線を通り、scope3Total（calculated 方式の採用値）が
  // 削除直後に最新化される（仕様書 §5.1-③）。削除では算定バッチを起こさず集計の再計算だけを行う。
  const deleteRecord = async () => {
    if (!editingRecord) return;
    setIsDeleting(true);
    try {
      const deletedPeriodStart = editingRecord.periodStart;
      await deleteActivityRecord(editingRecord.id);
      const refreshMessages = await refreshAggregatesForPeriod(deletedPeriodStart);
      await refreshHistory();
      setEditingRecord(null);
      showToast(['活動量を削除しました。', ...refreshMessages].join('\n'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '活動量の削除に失敗しました。', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return {
    editingRecord,
    initialValues,
    isDeleting,
    open: setEditingRecord,
    close: () => setEditingRecord(null),
    save,
    deleteRecord,
  };
}
