'use client';

// 統合フォーム（ActivityEntryForm）からの新規保存。Scope1/2 と Scope3積上げはサービスの保存経路が
// 異なるため、kind で振り分ける。どちらも 保存 → 履歴の先頭に追加 → 自動算定 → 履歴反映 の同じ流れ。

import type { ShowToast } from '@/hooks/useToast';
import { addManualActivityRecord, addScope3ActivityRecord } from '../services/activityRecordService';
import {
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ActivityEntryInput,
  type SavedManualActivityRecord,
  type Scope3ActivityRecordInput,
} from '../types';

export interface UseActivityEntrySaveParams {
  /** 保存直後に呼ぶ。履歴の先頭に足して 1 ページ目へ戻すのは呼び出し側 */
  onSaved: (record: SavedManualActivityRecord) => void;
  runAutoCalculation: (periodStarts: string[]) => Promise<string[]>;
  /** 算定後に一覧を取り直し、CO2排出量の列を反映する */
  refreshHistory: () => Promise<void>;
  showToast: ShowToast;
}

export interface ActivityEntrySave {
  save: (entry: ActivityEntryInput) => Promise<void>;
}

export function useActivityEntrySave({
  onSaved,
  runAutoCalculation,
  refreshHistory,
  showToast,
}: UseActivityEntrySaveParams): ActivityEntrySave {
  const saveManual = async (input: Parameters<typeof addManualActivityRecord>[0]) => {
    const savedRecord = await addManualActivityRecord(input);
    onSaved(savedRecord);
    showToast(
      `『${savedRecord.locationName}』の${MANUAL_ACTIVITY_CATEGORY_MAP[savedRecord.energyType].labelJP}データ（${savedRecord.amount.toLocaleString()} ${savedRecord.unit}）を登録しました。排出量を計算しています...`,
      'success',
    );
    // 保存後にそのまま排出量の計算まで実行して結果を反映する。
    // 計算失敗はメッセージ通知のみ（保存済みデータには影響しない）。
    const calcMessages = await runAutoCalculation([savedRecord.periodStart]);
    await refreshHistory();
    if (calcMessages.length > 0) {
      showToast(calcMessages.join('\n'), 'success');
    }
  };

  const saveScope3 = async (input: Scope3ActivityRecordInput) => {
    const savedRecord = await addScope3ActivityRecord(input);
    onSaved(savedRecord);
    const productLabel = savedRecord.ideaProductName ? `「${savedRecord.ideaProductName}」` : '';
    showToast(
      `『${savedRecord.locationName}』のScope3積上げデータ（カテゴリ${savedRecord.scope3CategoryId ?? '—'}・${productLabel}${savedRecord.amount.toLocaleString()} ${savedRecord.unit}）を登録しました。排出量を計算しています...`,
      'success',
    );
    const calcMessages = await runAutoCalculation([savedRecord.periodStart]);
    await refreshHistory();
    if (calcMessages.length > 0) {
      showToast(calcMessages.join('\n'), 'success');
    }
  };

  const save = async (entry: ActivityEntryInput) =>
    entry.kind === 'scope3' ? saveScope3(entry.input) : saveManual(entry.input);

  return { save };
}
