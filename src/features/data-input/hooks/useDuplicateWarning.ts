'use client';

// 重複の事前警告。拠点・カテゴリ・対象年月（Scope3積上げはさらにIDEA製品）が揃った時点で、保存時と同じ
// 重複キーを読み込み済みの入力履歴に照合し、活動量を入れる前に「既に登録済み」を知らせる。
// 警告はプレビュー・保存を止めない（履歴が古い可能性があるため、確定判定は保存時チェックに委ねる）。
//
// 保存に成功した直後は、フォームが拠点・カテゴリ・対象年月を保持したまま今保存したレコードが履歴に加わるため、
// そのままでは保存成功の通知と並んで「既に登録済み」が出てしまう。保存した条件を覚えておき、条件が変わるまで
// 警告を抑える。一度でも条件を変えれば（その後に同じ条件へ戻しても）通常どおり警告する。

import { useCallback, useMemo, useState } from 'react';
import {
  findDuplicateActivityRecord,
  isSameDuplicateCandidate,
  type ActivityEntryDuplicateCandidate,
  type DuplicateWarningRecord,
} from '../services/activityRecordDuplicates';
import type { EntryCategory } from '../services/entryCategory';

export interface DuplicateWarningParams<T extends DuplicateWarningRecord> {
  /** 読み込み済みの入力履歴（照合先）。 */
  historyRecords: readonly T[];
  /** 編集中レコード自身を重複に数えないための除外 id。 */
  excludeRecordId?: string;
  /** 選択中の拠点 id（'' なら未選択）。 */
  locationId: string;
  category: EntryCategory;
  /** 対象年月の開始日（'YYYY-MM-01'）。対象年月が不正なら null。 */
  periodStart: string | null;
  /** Scope3積上げで選択中の IDEA 製品 id。未選択なら null。 */
  ideaFactorId: string | null;
}

export interface DuplicateWarning<T extends DuplicateWarningRecord> {
  /** 現在の条件から組み立てた重複キー。条件が揃っていなければ null。 */
  candidate: ActivityEntryDuplicateCandidate | null;
  /** 現在の条件に一致する既存レコード。条件が揃っていない・一致なし・保存直後の同一条件なら null。 */
  record: T | null;
  /** 保存成功時に呼ぶ。現在の条件を保存済みとして覚え、条件が変わるまで警告を抑える。 */
  markSaved: () => void;
}

export function useDuplicateWarning<T extends DuplicateWarningRecord>({
  historyRecords,
  excludeRecordId,
  locationId,
  category,
  periodStart,
  ideaFactorId,
}: DuplicateWarningParams<T>): DuplicateWarning<T> {
  const candidate = useMemo((): ActivityEntryDuplicateCandidate | null => {
    if (periodStart === null || locationId === '') {
      return null;
    }
    if (category.kind === 'energy') {
      return { kind: 'scope12', locationId, energyType: category.energyType, periodStart };
    }
    // Scope3積上げの重複キーはIDEA製品まで含むため、製品が決まるまで判定しない。
    if (ideaFactorId === null) {
      return null;
    }
    return {
      kind: 'scope3',
      locationId,
      periodStart,
      scope3CategoryId: category.categoryId,
      ideaFactorId,
    };
  }, [periodStart, locationId, category, ideaFactorId]);

  const [savedCandidate, setSavedCandidate] = useState<ActivityEntryDuplicateCandidate | null>(null);
  // 保存時の条件から離れたら抑止を解く。render 中の条件付き setState は「入力の変化に合わせて state を
  // 調整する」React のパターンで、effect で行うより 1 レンダー早く反映され、警告が一瞬出てから消えることがない。
  if (
    savedCandidate !== null &&
    (candidate === null || !isSameDuplicateCandidate(candidate, savedCandidate))
  ) {
    setSavedCandidate(null);
  }
  const suppressed =
    savedCandidate !== null && candidate !== null && isSameDuplicateCandidate(candidate, savedCandidate);

  const record = useMemo(
    () =>
      candidate && !suppressed
        ? findDuplicateActivityRecord(historyRecords, candidate, { excludeRecordId })
        : null,
    [historyRecords, candidate, suppressed, excludeRecordId],
  );
  const markSaved = useCallback(() => setSavedCandidate(candidate), [candidate]);

  return { candidate, record, markSaved };
}
