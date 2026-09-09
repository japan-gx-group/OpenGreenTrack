'use client';

// 統合データ入力フォームの Scope1/2 係数選択（供給事業者別係数 / 標準係数）。
// 係数マスタの取得・キャッシュ、事業者選択 UI の状態、標準候補、保存する係数 ID、
// 「保存後の算定で実際に適用される係数」の判定をまとめ、フォーム本体は結果を描くだけにする。
// 判定ロジックは services/entryFactorSelection.ts の純関数、取得は hooks/useKeyedLoader.ts に委ねる。

import { useMemo, useState } from 'react';
import {
  applicableYearsForRecord,
  withProvisionalYears,
  deriveApplicableYear,
} from '@/features/calculation/engine/resolveEmissionFactor';
import type { EnergyType } from '@/features/calculation/types';
import type { ManualEntryLocationOption } from '../types';
import { isProviderCategory, type FactorTypeChoice } from '../services/entryCategory';
import {
  DEFAULT_PROVIDER_SELECTION,
  listApplicableProviderFactors,
  listEntryFactorCandidates,
  listMenuOptions,
  resolveAppliedFactor,
  resolveFactorIdToSave,
  resolveProviderFactor,
  resolveSelectedFactor,
  restoreProviderSelection,
  type AppliedFactorResolution,
  type ProviderLoadStatus,
  type ProviderSelection,
} from '../services/entryFactorSelection';
import {
  getActiveScope12Factors,
  getProviderFactors,
  type CandidateFactorRow,
} from '../services/factorSelectionService';
import type { ManualEntryPeriodDates } from '../services/manualEntryTargetMonth';
import { buildProviderOptions, type ProviderOption } from '../services/providerOptions';
import { useKeyedLoader } from './useKeyedLoader';

export const FACTOR_LOAD_ERROR_MESSAGE = '排出係数の取得に失敗しました。時間をおいて再度お試しください。';
const PROVIDER_LOAD_ERROR_MESSAGE = '供給事業者別係数の取得に失敗しました';

// 係数マスタは適用年度群ごとに 1 回だけ取得しキャッシュする（年月を行き来しても再取得しない）。
// キーは applicableYearsForRecord（会計年度の開始年＋対象月の温対法年度）に暫定適用の
// フォールバック年度を足したものを昇順 ',' 連結したもの。算定バッチ（calculationService）が
// 取得する年度集合と同じ範囲を対象月ごとに再現し、プレビューと算定結果をずらさない。
const loadYearFactors = (key: string) => getActiveScope12Factors(key.split(',').map(Number));
const yearsKeyOf = (periodStart: string, applicableYear: number): string =>
  withProvisionalYears(applicableYearsForRecord(periodStart, applicableYear)).join(',');
// 供給事業者別係数はカテゴリ×温対法年度ごとに 1 回だけ取得しキャッシュする（キー `${energyType}:${year}`）。
// 事業者別係数は公式係数（4月〜翌3月の有効期間）のため、会計年度の開始年ではなく対象月の温対法年度で引く。
const loadProviderFactors = (key: string) => {
  const [energyType, year] = key.split(':');
  return getProviderFactors(energyType, Number(year));
};

const EMPTY_FACTORS: CandidateFactorRow[] = [];

/** 入力条件の変更種別。カテゴリ変更だけは事業者・メニューの選択も解除する。 */
export type ConditionChange = 'location' | 'targetMonth' | 'category';

export interface UseScope12FactorSelectionArgs {
  /** factorSource が provider / standard のとき true。false（IDEA）なら取得も判定も行わない。 */
  enabled: boolean;
  energyType: EnergyType | null;
  location: ManualEntryLocationOption | undefined;
  period: ManualEntryPeriodDates | null;
  /** 親で fiscalYearsReady にゲート済みの適用年度。null の間は取得しない。 */
  applicableYear: number | null;
  isEdit: boolean;
  /** 編集で開いたレコードの emissionFactorId（Scope3 レコード・新規は null）。 */
  initialFactorId: string | null;
}

export interface Scope12FactorSelectionView {
  /** 標準係数を取得中（会計年度未確定を含む）。E2E の同期文言「排出係数を取得しています...」の表示条件 */
  isLoadingFactors: boolean;
  factorLoadError: string | null;
  isLoadingProviders: boolean;
  providerLoadFailed: boolean;
  /** 標準係数の取得失敗を破棄して再取得する */
  retryFactors: () => void;
  /** 事業者リストの取得失敗を破棄して再取得する */
  retryProviders: () => void;
  /** 標準係数が取得済み（候補判定が可能） */
  isFactorsReady: boolean;
  /**
   * 編集で保存されている係数指定を事業者リストから復元できるか、まだ判定できない（取得中）。
   * この間に年度をまたぐ対象年月の変更や拠点の変更を受けると復元が飛び代替値で保存されるため、
   * 呼び出し側は判定が確定するまで対象年月・拠点の変更を止める。
   */
  isRestorePending: boolean;
  providerOptions: ProviderOption[];
  menuOptions: CandidateFactorRow[];
  providerSelection: ProviderSelection;
  providerFactor: CandidateFactorRow | null;
  setFactorType: (value: FactorTypeChoice) => void;
  setProviderName: (value: string | null) => void;
  setMenuName: (value: string | null) => void;
  factorCandidates: CandidateFactorRow[];
  /** 候補セレクトの value（ユーザーの選択） */
  selectedFactor: CandidateFactorRow | null;
  selectFactorId: (factorId: string) => void;
  factorTouched: boolean;
  factorIdToSave: string | null;
  applied: AppliedFactorResolution;
  /** 拠点・対象年月・カテゴリの変更を通知する（上書き解除・factorTouched・事業者選択の解除） */
  onConditionChanged: (change: ConditionChange) => void;
}

export const useScope12FactorSelection = (
  args: UseScope12FactorSelectionArgs,
): Scope12FactorSelectionView => {
  const yearKey =
    args.enabled && args.applicableYear !== null && args.period !== null
      ? yearsKeyOf(args.period.start, args.applicableYear)
      : null;
  const providerKey =
    args.enabled &&
    args.energyType !== null &&
    isProviderCategory(args.energyType) &&
    args.applicableYear !== null &&
    args.period !== null
      ? `${args.energyType}:${deriveApplicableYear(args.period.start)}`
      : null;

  const yearLoader = useKeyedLoader(yearKey, loadYearFactors, FACTOR_LOAD_ERROR_MESSAGE);
  const providerLoader = useKeyedLoader(providerKey, loadProviderFactors, PROVIDER_LOAD_ERROR_MESSAGE);

  // ユーザーが候補セレクトで上書きした係数 ID（null = 優先順位による自動選択のまま）。
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(args.initialFactorId);
  // 編集時に係数 UI へ一度も触れていなければ、元の係数指定（initialFactorId）をそのまま維持する。
  // 触れずに保存したのに供給事業者係数が代替値へ勝手に置き換わるのを防ぐ。ユーザー操作の onChange でのみ true にする。
  const [factorTouched, setFactorTouched] = useState(false);
  // 供給事業者別係数の選択状態（電気・都市ガス・熱のみ）。事業者別係数は自動解決の対象外のため、
  // ここで選択した係数を明示指定として保存する。事業者未選択のままなら従来どおり自動解決（代替値）。
  // null = ユーザー未操作。その間は取得済みの事業者係数行から復元した値（派生）を使う。
  const [providerSelection, setProviderSelection] = useState<ProviderSelection | null>(null);

  const yearFactors = yearLoader.state?.status === 'ready' ? yearLoader.state.value : EMPTY_FACTORS;
  const factorLoadError = yearLoader.state?.status === 'error' ? yearLoader.state.message : null;
  // 事業者リストが取れなくても自動解決（代替値）で入力は継続できるため、警告扱いにせず [] として扱う。
  // 編集で元の係数を復元できたかどうかを区別するために失敗の有無だけ保持する。
  const fetchedProviderFactors =
    providerLoader.state?.status === 'ready' ? providerLoader.state.value : EMPTY_FACTORS;
  const providerLoadFailed = providerLoader.state?.status === 'error';
  const providerLoadStatus: ProviderLoadStatus =
    providerKey === null
      ? 'none'
      : providerLoader.state === undefined
        ? 'loading'
        : providerLoader.state.status;
  const isFactorsReady = yearKey !== null && yearLoader.state?.status === 'ready';
  const isRestorePending =
    args.isEdit && args.initialFactorId !== null && providerSelection === null && providerLoadStatus === 'loading';

  const scope = useMemo(
    () =>
      args.enabled && args.energyType !== null && args.location && args.period && args.applicableYear !== null
        ? {
            location: args.location,
            energyType: args.energyType,
            periodStart: args.period.start,
            applicableYear: args.applicableYear,
          }
        : null,
    [args.enabled, args.energyType, args.location, args.period, args.applicableYear],
  );
  // 取得した事業者係数行はフォールバック年度も含むため、この入力条件で算定バッチが採用し得る行に絞る
  // （対象年度が公表済みなら過年度の行を落とし、同じ事業者・メニューが年度違いで重複しないようにする）。
  // 復元・選択肢・メニュー候補・適用判定はすべてこの絞り込み後の集合を使う。
  const providerFactors = useMemo(
    () =>
      scope && fetchedProviderFactors.length > 0
        ? listApplicableProviderFactors(scope, yearFactors, fetchedProviderFactors)
        : fetchedProviderFactors,
    [scope, yearFactors, fetchedProviderFactors],
  );

  const restoredSelection = useMemo(
    () => (args.isEdit ? restoreProviderSelection(providerFactors, args.initialFactorId) : null),
    [args.isEdit, args.initialFactorId, providerFactors],
  );
  const effectiveSelection = providerSelection ?? restoredSelection ?? DEFAULT_PROVIDER_SELECTION;

  // 供給事業者の選択肢（登録番号順）。登録番号（UI 上の「事業者コード」）も検索対象に含める。
  const providerOptions = useMemo(() => buildProviderOptions(providerFactors), [providerFactors]);
  const menuOptions = useMemo(
    () => listMenuOptions(providerFactors, effectiveSelection),
    [providerFactors, effectiveSelection],
  );
  const providerFactor = useMemo(
    () => resolveProviderFactor(menuOptions, effectiveSelection.menuName),
    [menuOptions, effectiveSelection.menuName],
  );

  const factorCandidates = useMemo(
    () => (scope ? listEntryFactorCandidates(scope, yearFactors) : EMPTY_FACTORS),
    [scope, yearFactors],
  );
  const selectedFactor = resolveSelectedFactor({ providerFactor, candidates: factorCandidates, selectedFactorId });
  const factorIdToSave = resolveFactorIdToSave({
    isEdit: args.isEdit,
    factorTouched,
    initialFactorId: args.initialFactorId,
    selectedFactor,
  });
  const applied = useMemo<AppliedFactorResolution>(() => {
    // 標準係数の取得に失敗したときは判定不能として扱い、保存（算定バッチの自動解決）は妨げない。
    if (scope && factorLoadError !== null) {
      return { status: 'unknown', reason: 'standard' };
    }
    if (!scope || !isFactorsReady) {
      return { status: 'pending' };
    }
    return resolveAppliedFactor({
      scope,
      yearFactors,
      providerFactors,
      providerLoadStatus,
      providerNameSelected: effectiveSelection.providerName !== null,
      factorIdToSave,
    });
  }, [
    scope,
    factorLoadError,
    isFactorsReady,
    yearFactors,
    providerFactors,
    providerLoadStatus,
    effectiveSelection.providerName,
    factorIdToSave,
  ]);

  const touch = () => setFactorTouched(true);

  return {
    isLoadingFactors: yearLoader.isLoading,
    factorLoadError,
    isLoadingProviders: providerLoader.isLoading,
    providerLoadFailed,
    retryFactors: yearLoader.retry,
    retryProviders: providerLoader.retry,
    isFactorsReady,
    isRestorePending,
    providerOptions,
    menuOptions,
    providerSelection: effectiveSelection,
    providerFactor,
    setFactorType: (value) => {
      setProviderSelection({ ...effectiveSelection, factorType: value });
      touch();
    },
    setProviderName: (value) => {
      setProviderSelection({ ...effectiveSelection, providerName: value, menuName: null });
      setSelectedFactorId(null);
      touch();
    },
    setMenuName: (value) => {
      setProviderSelection({ ...effectiveSelection, menuName: value });
      touch();
    },
    factorCandidates,
    selectedFactor,
    selectFactorId: (factorId) => {
      setSelectedFactorId(factorId);
      touch();
    },
    factorTouched,
    factorIdToSave,
    applied,
    // 入力条件が変わったら係数の上書き選択は解除し、自動選択へ戻す。
    // 事業者別係数はカテゴリ固有のため、カテゴリ変更では事業者・メニューの選択を解除する（計算方法は維持）。
    // 拠点・対象年月の変更では事業者選択を維持し、年度が変われば同事業者の新年度係数へ自動追従させる。
    onConditionChanged: (change) => {
      setSelectedFactorId(null);
      touch();
      if (change === 'category') {
        setProviderSelection({ ...effectiveSelection, providerName: null, menuName: null });
      } else if (providerSelection === null && restoredSelection !== null) {
        // 復元した事業者選択は取得済みの行から導く派生値なので、年度が変わって行が入れ替わると失われる。
        // 拠点・対象年月の変更時点で state に固定し、新年度の同事業者係数へ追従できるようにする。
        setProviderSelection(restoredSelection);
      }
    },
  };
};
