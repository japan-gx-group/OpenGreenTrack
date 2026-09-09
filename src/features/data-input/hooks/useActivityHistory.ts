'use client';

// 入力履歴（活動量レコード）と手動入力の拠点候補の読込・再取得。
// 画面を開いたときと、ヘッダーの更新ボタン（refreshToken）で取り直す。
// 保存直後の行は prepend で先頭に足し、しばらく「NEW」を出す。

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import type { ShowToast } from '@/hooks/useToast';
import { formatDateTime } from '@/lib/datetime';
import { SCOPE3_CATEGORY_NAMES } from '@/features/scope-analysis/services/scopeAnalysisService';
import { getActivityHistoryRecords, getManualEntryLocations } from '../services/activityRecordService';
import type { HistoryFilterItem } from '../services/activityHistoryFilter';
import {
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ManualEntryLocationOption,
  type SavedManualActivityRecord,
} from '../types';

export interface HistoryItem extends HistoryFilterItem {
  isNew?: boolean;
  /** 算定済みの排出量（t-CO2e）。未算定は null。 */
  emissions?: number | null;
  /** 編集モーダルを開くための元レコード。 */
  record?: SavedManualActivityRecord;
  /** Scope3積上げ行のカテゴリ表示（例 'カテゴリ1: 購入した製品・サービス'）。 */
  scope3CategoryLabel?: string | null;
  /** Scope3積上げ行の IDEA 製品名（参照切れは null）。 */
  ideaProductName?: string | null;
}

const NEW_ROW_HIGHLIGHT_MS = 2500;

const toHistoryPeriod = (periodStart: string, periodEnd: string) =>
  `${periodStart.replace(/-/g, '/')} - ${periodEnd.replace(/-/g, '/')}`;

// 排出量（t-CO2e）の表示。未算定（null）は「未算定」と示す。
const formatEmissions = (emissions: number | null | undefined): string =>
  emissions === null || emissions === undefined
    ? '未算定'
    : emissions.toLocaleString('ja-JP', { maximumFractionDigits: 3 });

// Scope3積上げ行のカテゴリ表示（例 'カテゴリ1: 購入した製品・サービス'）。
const toScope3CategoryLabel = (record: SavedManualActivityRecord): string | null => {
  if (record.energyType !== 'scope3_activity' || record.scope3CategoryId === null) {
    return null;
  }
  const name = SCOPE3_CATEGORY_NAMES[record.scope3CategoryId];
  return name
    ? `カテゴリ${record.scope3CategoryId}: ${name}`
    : `カテゴリ${record.scope3CategoryId}`;
};

export const toHistoryItem = (
  record: SavedManualActivityRecord,
  isNew = false,
): HistoryItem => {
  const scope3CategoryLabel = toScope3CategoryLabel(record);
  return {
    id: record.id,
    name: record.locationName,
    locationValue: record.locationId,
    energy: MANUAL_ACTIVITY_CATEGORY_MAP[record.energyType].labelJP,
    categoryValue: record.energyType,
    amount: record.amount.toLocaleString(),
    unit: record.unit,
    period: toHistoryPeriod(record.periodStart, record.periodEnd),
    periodMonth: record.periodStart.slice(0, 7),
    periodEndMonth: record.periodEnd.slice(0, 7),
    status: '登録済み',
    date: formatDateTime(record.createdAt),
    createdAt: record.createdAt,
    noteText: record.note ?? '',
    emissionsText: formatEmissions(record.emissions),
    // Scope3積上げ行はカテゴリ名・製品名でもキーワード検索に当たるようにする。
    extraSearchText: [scope3CategoryLabel ?? '', record.ideaProductName ?? '']
      .join(' ')
      .trim(),
    isNew,
    emissions: record.emissions,
    record,
    scope3CategoryLabel,
    ideaProductName: record.ideaProductName,
  };
};

export interface ActivityHistory {
  history: HistoryItem[];
  manualEntryLocations: ManualEntryLocationOption[];
  /** 「最新の状態に更新」の実行中 */
  isRefreshing: boolean;
  /**
   * 入力履歴の「最新の状態に更新」。活動量レコードを排出量つきで取り直して一覧を再構築する。
   * 現在ページは意図的に維持する（行編集・削除もこの関数を通るため、
   * ここでリセットすると編集のたびに1ページ目へ戻されてしまう）。
   * 件数が減ってページが範囲外になるケースはページング側で吸収する。
   */
  refresh: () => Promise<void>;
  /** 保存した行を先頭に足し、しばらく「NEW」を出す。1 ページ目へ戻すのは呼び出し側の責務 */
  prepend: (record: SavedManualActivityRecord) => void;
  /**
   * 未算定（emission_results が無い）レコード。「未算定分を再計算」の対象と件数表示に使う。
   * 係数未解決で残った分も含む（係数を登録した後にここから再計算できる）。
   */
  uncalculatedItems: HistoryItem[];
}

export function useActivityHistory(showToast: ShowToast): ActivityHistory {
  const { refreshToken } = useAppRefresh();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [manualEntryLocations, setManualEntryLocations] = useState<ManualEntryLocationOption[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // 「NEW」を外すタイマー。保存直後に画面を離れたとき、アンマウント後の setHistory を呼ばないよう
  // 全部を控えておいて後始末する（連続保存では各保存のタイマーがそれぞれ全行の NEW を外す）。
  const highlightTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    Promise.all([getManualEntryLocations(), getActivityHistoryRecords()])
      .then(([fetchedManualEntryLocations, fetchedManualActivityRecords]) => {
        if (!isMounted) {
          return;
        }

        setManualEntryLocations(fetchedManualEntryLocations);
        setHistory(fetchedManualActivityRecords.map((record) => toHistoryItem(record)));
      })
      .catch(() => {
        // 取得失敗時も画面が固まらないよう握りつぶさずに通知する。
        if (isMounted) {
          showToast('拠点の取得に失敗しました。時間をおいて再度お試しください。', 'error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [showToast, refreshToken]);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      const records = await getActivityHistoryRecords();
      setHistory(records.map((record) => toHistoryItem(record)));
    } catch {
      showToast('入力履歴の取得に失敗しました。時間をおいて再度お試しください。', 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const prepend = (record: SavedManualActivityRecord) => {
    const newItem = toHistoryItem(record, true);

    setHistory(prev => [newItem, ...prev]);
    const timer = setTimeout(() => {
      highlightTimersRef.current.delete(timer);
      setHistory(current =>
        current.map(item => item.isNew ? { ...item, isNew: false } : item)
      );
    }, NEW_ROW_HIGHLIGHT_MS);
    highlightTimersRef.current.add(timer);
  };

  const uncalculatedItems = useMemo(() => history.filter((item) => item.emissions === null), [history]);

  return { history, manualEntryLocations, isRefreshing, refresh, prepend, uncalculatedItems };
}
