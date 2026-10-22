'use client';

// 統合フォーム（ActivityEntryForm）からの新規保存。Scope1/2 と Scope3積上げはサービスの保存経路が
// 異なるため、kind で振り分ける。どちらも 保存 → 履歴の先頭に追加 → 自動算定 → 履歴反映 の同じ流れ。

import type { ShowToast } from '@/hooks/useToast';
import {
  addManualActivityRecord,
  addScope3ActivityRecord,
  updateManualActivityRecord,
  updateScope3ActivityRecord,
} from '../services/activityRecordService';
import type { BulkSaveItem } from '../services/bulkEntry';
import {
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ActivityEntryInput,
  type SavedManualActivityRecord,
  type Scope3ActivityRecordInput,
} from '../types';

export interface UseActivityEntrySaveParams {
  /** 保存直後に呼ぶ。履歴の先頭に足して 1 ページ目へ戻すのは呼び出し側 */
  onSaved: (record: SavedManualActivityRecord) => void;
  /** 一括保存の完了後（履歴の再取得後）に呼ぶ。1 ページ目へ戻すのは呼び出し側 */
  onBulkSaved?: () => void;
  runAutoCalculation: (periodStarts: string[]) => Promise<string[]>;
  /** 算定後に一覧を取り直し、CO2排出量の列を反映する */
  refreshHistory: () => Promise<void>;
  showToast: ShowToast;
}

export interface ActivityEntrySave {
  save: (entry: ActivityEntryInput) => Promise<void>;
  /** 一括入力（複数月まとめて入力）の保存。月ごとに順に保存し、算定は 1 回で行う */
  saveBulk: (items: BulkSaveItem[]) => Promise<void>;
}

export function useActivityEntrySave({
  onSaved,
  onBulkSaved,
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

  // 一括保存の 1 件分。新規は登録、上書きは既存レコードの更新（isCalculated=false へ戻り再算定対象になる）。
  const saveBulkItem = (item: BulkSaveItem): Promise<SavedManualActivityRecord> => {
    if (item.entry.kind === 'scope3') {
      return item.action === 'overwrite'
        ? updateScope3ActivityRecord(item.recordId, item.entry.input)
        : addScope3ActivityRecord(item.entry.input);
    }
    return item.action === 'overwrite'
      ? updateManualActivityRecord(item.recordId, item.entry.input)
      : addManualActivityRecord(item.entry.input);
  };

  // 月ごとに順に保存する（並列にしない。重複トリガーなど途中の失敗時に「どこまで保存されたか」を
  // 明確にするため）。途中で失敗しても保存済みの月は取り消さず、算定・履歴反映まで行ってから
  // 失敗した月をエラーとして伝える（グリッドは履歴再取得で保存済みの月が登録済み表示に変わる）。
  // 保存済みの月の算定結果（件数・未算定の理由など）は失敗時も捨てず、保存済み件数と一緒にトーストで残す
  // （フォームのエラー表示は失敗した月の案内だけを出す）。
  const saveBulk = async (items: BulkSaveItem[]) => {
    const saved: SavedManualActivityRecord[] = [];
    let overwriteCount = 0;
    let failure: { item: BulkSaveItem; reason: string } | null = null;
    for (const item of items) {
      try {
        saved.push(await saveBulkItem(item));
        if (item.action === 'overwrite') {
          overwriteCount += 1;
        }
      } catch (error) {
        failure = {
          item,
          reason: error instanceof Error ? error.message : '活動量レコードの保存に失敗しました',
        };
        break;
      }
    }

    if (saved.length > 0) {
      const first = saved[0];
      const categoryLabel =
        first.energyType === 'scope3_activity'
          ? `Scope3積上げ（カテゴリ${first.scope3CategoryId ?? '—'}）`
          : MANUAL_ACTIVITY_CATEGORY_MAP[first.energyType].labelJP;
      const breakdown =
        overwriteCount > 0 ? `（新規${saved.length - overwriteCount}件・上書き${overwriteCount}件）` : '';
      const savedSummary = `『${first.locationName}』の${categoryLabel}データを${saved.length}ヶ月分保存しました${breakdown}`;
      if (failure === null) {
        showToast(`${savedSummary}。排出量を計算しています...`, 'success');
      }
      const calcMessages = await runAutoCalculation([
        ...new Set(saved.map((record) => record.periodStart)),
      ]);
      await refreshHistory();
      onBulkSaved?.();
      if (failure === null) {
        if (calcMessages.length > 0) {
          showToast(calcMessages.join('\n'), 'success');
        }
      } else {
        showToast(
          [`${savedSummary}。${failure.item.label}以降は保存されていません。`, ...calcMessages].join('\n'),
          'error',
        );
      }
    }

    if (failure !== null) {
      throw new Error(
        saved.length > 0
          ? `${failure.item.label}の保存に失敗しました（${saved.length}件は保存済みです）: ${failure.reason}`
          : failure.reason,
      );
    }
  };

  return { save, saveBulk };
}
