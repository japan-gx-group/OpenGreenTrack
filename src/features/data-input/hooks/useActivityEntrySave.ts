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
import { linkEvidence } from '@/features/activity-evidence/services/evidenceClient';
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

/** 帳票を紐づけられなかったときの案内（記録の保存の通知に続けて出す） */
export const EVIDENCE_LINK_FAILURE_MESSAGE =
  '帳票を紐づけられませんでした。入力履歴から記録を開いて、帳票を追加し直してください';

/** 保存のときに一緒に行うこと（新規入力の帳票の紐づけ） */
export interface ActivityEntrySaveOptions {
  /** 保存した記録に紐づける帳票の ID */
  evidenceFileIds?: string[];
}

/** まとめて登録する 1 件（請求書の一括登録の表の 1 行） */
export interface ActivityEntrySaveManyItem {
  /** 呼び出し側の行の識別子（結果の対応付けに使う） */
  key: string;
  entry: ActivityEntryInput;
  evidenceFileIds: string[];
}

/** まとめて登録した結果。保存できた行と、保存できなかった行・理由 */
export interface ActivityEntrySaveManyResult {
  savedKeys: string[];
  failures: Array<{ key: string; reason: string }>;
}

export interface ActivityEntrySave {
  save: (entry: ActivityEntryInput, options?: ActivityEntrySaveOptions) => Promise<void>;
  /**
   * 拠点・カテゴリ・月がまちまちの記録をまとめて登録する（請求書の一括登録）。1 件ずつ保存して帳票を紐づけ、
   * 失敗した行があっても残りは続ける。算定は最後に 1 回だけ行う。
   */
  saveMany: (items: ActivityEntrySaveManyItem[]) => Promise<ActivityEntrySaveManyResult>;
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
  // 記録は保存できたのに帳票を紐づけられなかったときは、保存の失敗にはせず（記録は残る）、紐づけ直しを案内する。
  const attachEvidence = async (
    record: SavedManualActivityRecord,
    evidenceFileIds: string[] = [],
  ): Promise<{ record: SavedManualActivityRecord; evidenceFailed: boolean }> => {
    if (evidenceFileIds.length === 0) return { record, evidenceFailed: false };
    try {
      await linkEvidence(record.id, evidenceFileIds);
      return { record: { ...record, evidenceCount: evidenceFileIds.length }, evidenceFailed: false };
    } catch {
      return { record, evidenceFailed: true };
    }
  };

  // 保存の通知と、続けて行う排出量の計算。トーストは 1 件しか出せず後の通知で上書きされるため、帳票を紐づけられ
  // なかったことは保存の通知にも計算結果の通知にも入れ、最後に残る通知から消えないようにする。
  const announceSavedAndCalculate = async (
    savedRecord: SavedManualActivityRecord,
    savedLabel: string,
    evidenceFailed: boolean,
  ) => {
    showToast(
      evidenceFailed
        ? `${savedLabel}を登録しましたが、${EVIDENCE_LINK_FAILURE_MESSAGE}`
        : `${savedLabel}を登録しました。排出量を計算しています...`,
      evidenceFailed ? 'error' : 'success',
    );
    // 保存後にそのまま排出量の計算まで実行して結果を反映する。
    // 計算失敗はメッセージ通知のみ（保存済みデータには影響しない）。
    const calcMessages = await runAutoCalculation([savedRecord.periodStart]);
    await refreshHistory();
    if (calcMessages.length > 0) {
      showToast(
        [...(evidenceFailed ? [`記録は登録しましたが、${EVIDENCE_LINK_FAILURE_MESSAGE}`] : []), ...calcMessages].join('\n'),
        evidenceFailed ? 'error' : 'success',
      );
    }
  };

  const saveManual = async (input: Parameters<typeof addManualActivityRecord>[0], options?: ActivityEntrySaveOptions) => {
    const { record: savedRecord, evidenceFailed } = await attachEvidence(
      await addManualActivityRecord(input),
      options?.evidenceFileIds,
    );
    onSaved(savedRecord);
    await announceSavedAndCalculate(
      savedRecord,
      `『${savedRecord.locationName}』の${MANUAL_ACTIVITY_CATEGORY_MAP[savedRecord.energyType].labelJP}データ（${savedRecord.amount.toLocaleString()} ${savedRecord.unit}）`,
      evidenceFailed,
    );
  };

  const saveScope3 = async (input: Scope3ActivityRecordInput, options?: ActivityEntrySaveOptions) => {
    const { record: savedRecord, evidenceFailed } = await attachEvidence(
      await addScope3ActivityRecord(input),
      options?.evidenceFileIds,
    );
    onSaved(savedRecord);
    const productLabel = savedRecord.ideaProductName ? `「${savedRecord.ideaProductName}」` : '';
    await announceSavedAndCalculate(
      savedRecord,
      `『${savedRecord.locationName}』のScope3積上げデータ（カテゴリ${savedRecord.scope3CategoryId ?? '—'}・${productLabel}${savedRecord.amount.toLocaleString()} ${savedRecord.unit}）`,
      evidenceFailed,
    );
  };

  const save = async (entry: ActivityEntryInput, options?: ActivityEntrySaveOptions) =>
    entry.kind === 'scope3' ? saveScope3(entry.input, options) : saveManual(entry.input, options);

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

  const saveMany = async (items: ActivityEntrySaveManyItem[]): Promise<ActivityEntrySaveManyResult> => {
    const saved: SavedManualActivityRecord[] = [];
    const savedKeys: string[] = [];
    const failures: Array<{ key: string; reason: string }> = [];
    let linkFailed = 0;
    for (const item of items) {
      let record: SavedManualActivityRecord;
      try {
        record =
          item.entry.kind === 'scope3'
            ? await addScope3ActivityRecord(item.entry.input)
            : await addManualActivityRecord(item.entry.input);
      } catch (error) {
        failures.push({ key: item.key, reason: error instanceof Error ? error.message : '活動量レコードの保存に失敗しました' });
        continue;
      }
      // 紐づけに失敗しても記録は保存済みなので、保存できた行として扱い、紐づけ直しを案内する。
      if (item.evidenceFileIds.length > 0) {
        try {
          await linkEvidence(record.id, item.evidenceFileIds);
          record = { ...record, evidenceCount: item.evidenceFileIds.length };
        } catch {
          linkFailed += 1;
        }
      }
      saved.push(record);
      savedKeys.push(item.key);
    }

    if (saved.length > 0) {
      showToast(`請求書から ${saved.length} 件の活動量を登録しました。排出量を計算しています...`, 'success');
      const calcMessages = await runAutoCalculation([...new Set(saved.map((record) => record.periodStart))]);
      await refreshHistory();
      onBulkSaved?.();
      const notices = [
        ...(failures.length > 0 ? [`${failures.length} 件は登録できませんでした。表の理由を確かめてください。`] : []),
        ...(linkFailed > 0
          ? [`${linkFailed} 件は記録を保存しましたが、帳票を紐づけられませんでした。入力履歴から記録を開いて、帳票を追加してください。`]
          : []),
        ...calcMessages,
      ];
      if (notices.length > 0) {
        showToast(notices.join('\n'), failures.length > 0 || linkFailed > 0 ? 'error' : 'success');
      }
    } else if (failures.length > 0) {
      showToast(`選んだ明細を登録できませんでした（${failures.length} 件）。表の理由を確かめてください。`, 'error');
    }
    return { savedKeys, failures };
  };

  return { save, saveBulk, saveMany };
}
