// 拠点削除の安全ガード（純粋関数）。locationService と削除確認モーダルで共有する。
// 機能仕様 §5.2 V-LOC-004: 「削除時、未算定の ActivityRecord があれば不可」。
// 「未算定」は算定エンジン（calculationService）と同じ定義で、
// isCalculated = false の activity_records を指す。

// 拠点削除の影響範囲。件数は locationService.getLocationDeletionImpact が
// head + count クエリで取得する（行本体は転送しない）。
export interface LocationDeletionImpact {
  /** 拠点に紐づく活動量データ（activity_records）の件数 */
  activityRecordCount: number;
  /** 拠点に紐づく算定結果（emission_results）の件数 */
  emissionResultCount: number;
  /** 未算定（isCalculated = false）の活動量データ件数。1件でもあれば削除不可 */
  uncalculatedCount: number;
  /** 活動量データの対象期間の開始（最小の periodStart。データがなければ null） */
  periodFrom: string | null;
  /** 活動量データの対象期間の終了（最大の periodEnd。データがなければ null） */
  periodTo: string | null;
}

// V-LOC-004 の判定。未算定の活動量データが1件でも残っていれば削除不可（false）。
export const canDeleteLocation = (impact: LocationDeletionImpact): boolean =>
  impact.uncalculatedCount <= 0;

// V-LOC-004 のエラーメッセージ（機能仕様 §5.2 の文言＋次アクションの案内）。
export const LOCATION_DELETE_BLOCKED_MESSAGE =
  '未処理の入力データがあるため削除できません。先に算定を実行してください。';

// 'YYYY-MM-DD' の日付文字列を「YYYY年M月」に整形する。
// Date に通すとタイムゾーンで月がずれ得るため、文字列のまま分解する。
// 想定外の形式はそのまま返して表示を壊さない。
export const formatMonthJa = (isoDate: string): string => {
  const [year, month] = isoDate.split('-');
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return isoDate;
  }
  return `${y}年${m}月`;
};

// 影響範囲の対象期間表示（例: 「2024年4月〜2025年3月」）。
// 開始と終了が同じ月なら「2024年4月」、期間が不明なら null を返す。
export const formatImpactPeriod = (
  impact: Pick<LocationDeletionImpact, 'periodFrom' | 'periodTo'>,
): string | null => {
  if (!impact.periodFrom || !impact.periodTo) return null;
  const from = formatMonthJa(impact.periodFrom);
  const to = formatMonthJa(impact.periodTo);
  return from === to ? from : `${from}〜${to}`;
};
