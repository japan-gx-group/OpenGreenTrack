// IDEA の版を会計年度に割り当てるカードの表示ロジック（純関数）。
// 割り当ての結果の通知文と、版を削除できるかの判定を画面から切り出してテストできるようにする。

import type {
  IdeaFiscalYearAssignmentResult,
  IdeaImportHistory,
  IdeaImportRecord,
} from '../services/ideaImportClient';

/** 年度への割り当て（または解除）の結果を、トースト用の文言にする。 */
export const buildAssignmentMessage = (input: {
  fiscalYearLabel: string;
  /** 割り当てた版の表記。割り当てを外したときは null */
  assignedVersion: string | null;
  /** 割り当てを外したときに使う有効な版の表記（無ければ null） */
  activeVersion: string | null;
  result: IdeaFiscalYearAssignmentResult;
}): string => {
  const { fiscalYearLabel, assignedVersion, activeVersion, result } = input;
  const messages = [
    assignedVersion !== null
      ? `${fiscalYearLabel}に ${assignedVersion} を割り当てました。`
      : activeVersion !== null
        ? `${fiscalYearLabel}の割り当てを外しました。有効な版（${activeVersion}）を使います。`
        : `${fiscalYearLabel}の割り当てを外しました。`,
  ];
  if (result.remappedCount > 0) {
    messages.push(`この年度の未算定のデータ ${result.remappedCount} 件を、この版の製品に付け替えました。`);
  }
  if (result.unmappedCount > 0) {
    messages.push(
      `${result.unmappedCount} 件はこの版に同じ製品が無いため、データ入力の入力履歴から開いて製品を選び直してください。`,
    );
  }
  return messages.join('\n');
};

/** 版を削除できない理由（削除できるなら null）。有効な版の削除は IDEA データベースカードから行う。 */
export const deleteBlockedReason = (
  record: IdeaImportRecord,
  history: IdeaImportHistory,
): string | null => {
  if (record.isActive) {
    return '有効な版は、IDEAデータベースカードから削除します';
  }
  if (history.assignments.some((assignment) => assignment.importId === record.id)) {
    return '算定年度に割り当て中です。先に割り当てを外してください';
  }
  if ((history.referenceCountByImportId[record.id] ?? 0) > 0) {
    return '算定結果から参照されているため削除できません';
  }
  return null;
};
