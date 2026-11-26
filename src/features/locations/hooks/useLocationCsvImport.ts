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
  completedCount: number;
  selectFile: (file: File) => Promise<void>;
  cancelImport: () => void;
  runImport: () => Promise<void>;
}

// 取込を途中で止めたときのファイル単位のエラー文。止めた理由に、確認できない件数と試みていない件数を添える。
// 応答が届かなかった行は書き込まれている可能性があるため、「取り込んでいない」には数えない。
const describeStop = (reason: string, unconfirmedCount: number, notAttemptedCount: number): string => {
  const parts = [reason];
  if (unconfirmedCount > 0) {
    parts.push(`${unconfirmedCount}件は反映されたか確認できません。一覧で確かめてから取り込み直してください`);
  }
  if (notAttemptedCount > 0) parts.push(`残りの${notAttemptedCount}件は取り込んでいません`);
  return parts.join('。');
};

export function useLocationCsvImport(
  database: LocationRecord[],
  /** 取込後に一覧を取り直す（採番された ID と更新後の値を反映するため）。失敗は throw する */
  reload: () => Promise<void>,
  showToast: ShowToast,
): LocationCsvImportController {
  const [importErrors, setImportErrors] = useState<LocationImportRowError[]>([]);
  const [importPreview, setImportPreview] = useState<LocationImportPreview | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

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
    setCompletedCount(0);
    setIsImporting(true);
    // 作成・更新の途中で throw しても一覧を取り直す（作成分が書き込み済みなのに画面が変わらない、という状態を残さないため）。
    // throw した工程の件数は service から返らず確定できないので null（件数不明）のままにし、0件とは区別する。
    let addedCount: number | null = null;
    let updatedCount: number | null = null;
    const runtimeErrors: LocationImportRowError[] = [];
    let writeFailure: string | null = null;
    try {
      // 行ごとに addLocation / updateLocation を呼ぶと、テンプレートが想定する規模
      // （数百行）で往復回数が現実的でなくなるため、一括版を使う。
      // 失敗は添字で返るので、行番号つきのエラーへ戻す。
      const createResult = await addLocations(
        plan.creates.map(create => create.location),
        setCompletedCount,
      );
      addedCount = createResult.created.length;
      runtimeErrors.push(
        ...createResult.failures.map(failure => ({
          row: plan.creates[failure.index].row,
          reasons: [failure.message],
        })),
      );

      if (createResult.stopped !== null) {
        // ログイン切れ・レート制限などリクエスト全体が原因で止まったときは、更新も同じ理由で失敗するため実行しない。
        // 行エラーを行数分並べず、ファイル単位のエラー1件として通知する。
        const { stopped } = createResult;
        const handled = createResult.created.length + createResult.failures.length + stopped.unconfirmedCount;
        updatedCount = 0;
        writeFailure = describeStop(stopped.reason, stopped.unconfirmedCount, plan.creates.length - handled + plan.updates.length);
      } else {
        const updateResult = await updateLocations(
          plan.updates.map(update => ({ id: update.targetId, location: update.location })),
          completed => setCompletedCount(plan.creates.length + completed),
        );
        updatedCount = updateResult.updated.length;
        runtimeErrors.push(
          ...updateResult.failures.map(failure => ({
            row: plan.updates[failure.index].row,
            reasons: [failure.message],
          })),
        );
        if (updateResult.stopped !== null) {
          const { stopped } = updateResult;
          const handled = updateResult.updated.length + updateResult.failures.length + stopped.unconfirmedCount;
          writeFailure = describeStop(stopped.reason, stopped.unconfirmedCount, plan.updates.length - handled);
        }
      }
    } catch (error: unknown) {
      writeFailure = error instanceof Error ? error.message : 'CSVインポートに失敗しました';
    }

    // 書き込みはここまでで確定している（行ごとに実行するため部分的に反映され得る）。
    // 結果の通知を先に済ませ、この後の再取得が失敗しても「どの行が失敗したか」を失わない。
    const allErrors = [...plan.errors, ...runtimeErrors].sort((a, b) => a.row - b.row);
    setImportErrors(allErrors);
    // 記入例行はエラーでもスキップでもないので、除外したときだけ末尾に添える
    const exampleNote = plan.exampleRowCount > 0 ? `・記入例${plan.exampleRowCount}件を除外` : '';
    const countLabel = (count: number | null) => (count === null ? '件数不明' : `${count}件`);
    const summary = `追加${countLabel(addedCount)}・更新${countLabel(updatedCount)}・スキップ${plan.skipCount}件・エラー${allErrors.length}件${exampleNote}`;
    if (writeFailure !== null) {
      showToast(`CSVインポートが途中で失敗しました（${writeFailure}）: ${summary}`, 'error');
    } else {
      showToast(`CSVインポート完了: ${summary}`, allErrors.length > 0 ? 'error' : 'success');
    }

    try {
      // 反映された可能性があれば一覧を取り直す（採番されたIDと更新後の値を表示に反映するため）。
      // throw した場合は件数に関係なく一部が書き込み済みかもしれないので取り直す。
      // 取込が完了していれば、再取得の失敗を取込の失敗として通知しない。
      // 取込が途中で止まった場合（ログイン切れなど）は再取得も同じ理由で失敗しやすいため、「完了」とは書かない。
      if (writeFailure !== null || (addedCount ?? 0) > 0 || (updatedCount ?? 0) > 0) {
        try {
          await reload();
        } catch {
          showToast(
            writeFailure !== null
              ? '一覧の再取得にも失敗しました。画面を再読み込みしてください。'
              : '取込は完了しましたが、一覧の再取得に失敗しました。画面を再読み込みしてください。',
            'error',
          );
        }
      }
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
    completedCount,
    selectFile,
    cancelImport: () => setImportPreview(null),
    runImport,
  };
}
