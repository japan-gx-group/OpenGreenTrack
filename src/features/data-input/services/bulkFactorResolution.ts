// 一括入力（複数月まとめて入力）の月ごとの係数解決。
// 会計年度内の月でも、非4月始まりの組織では温対法年度の境界をまたぐと適用できる係数の行が
// 変わる（公式係数は温対法年度＋有効期間で管理される）ため、単一の係数 ID を全月へ使い回さず、
// 単月入力と同じ純関数（entryFactorSelection / resolveAppliedFactor）を月ごとに通して
// 「保存する係数 ID」と「算定で実際に適用される係数」を求める。
// 係数マスタの取得は単月入力（useScope12FactorSelection）と同じ年度キーで行い、
// 同じ年度集合の月はキャッシュを共有する（1 会計年度あたり最大 2 集合）。

import {
  applicableYearsForRecord,
  deriveApplicableYear,
  withProvisionalYears,
} from '@/features/calculation/engine/resolveEmissionFactor';
import type { EnergyType } from '@/features/calculation/types';
import type { ManualEntryLocationOption } from '../types';
import { isProviderCategory } from './entryCategory';
import {
  listApplicableProviderFactors,
  listEntryFactorCandidates,
  listMenuOptions,
  resolveAppliedFactor,
  resolveProviderFactor,
  resolveSelectedFactor,
  type AppliedFactorResolution,
  type ProviderSelection,
} from './entryFactorSelection';
import {
  getActiveScope12Factors,
  getProviderFactors,
  type CandidateFactorRow,
} from './factorSelectionService';
import { applicableYearForDate, type FiscalYearRange } from './inlineCalculation';

/** フォームの係数選択状態のうち、月ごとの解決に必要な部分。 */
export interface BulkFactorSelectionState {
  providerSelection: ProviderSelection;
  /** 標準係数の候補セレクトでの上書き選択（null = 自動選択）。 */
  selectedFactorId: string | null;
}

export interface BulkMonthFactor {
  /** この月のレコードへ保存する係数 ID（候補が無ければ null = 算定時に自動解決）。 */
  factorIdToSave: string | null;
  /** 保存後の算定で実際に適用される係数の判定（単月入力のプレビューと同じ基準）。 */
  applied: AppliedFactorResolution;
  /**
   * 供給事業者を選択しているのに、この月の温対法年度にはその事業者（計算方法）の係数行が無く、
   * 自動選択（候補先頭＝代替値）へ落ちたか。保存する id 自体を自動選択の係数にするため
   * applied.fellBack では検出できず、確認モーダルで月ごとに代替値の適用を知らせるために別に持つ。
   */
  providerFellBack: boolean;
}

/** テストで Supabase を使わずに差し替えるための取得関数群。 */
export interface BulkFactorFetchers {
  fetchYearFactors: (applicableYears: number[]) => Promise<CandidateFactorRow[]>;
  fetchProviderFactors: (energyType: string, applicableYear: number) => Promise<CandidateFactorRow[]>;
}

const defaultFetchers: BulkFactorFetchers = {
  fetchYearFactors: getActiveScope12Factors,
  fetchProviderFactors: getProviderFactors,
};

/**
 * 対象月ごとの係数を解決する。戻り値は month（'YYYY-MM'）→ BulkMonthFactor。
 * 事業者・メニューは名前で月ごとに引き直す（年度が変われば同事業者の新年度係数へ自動追従）。
 * 標準係数の上書き選択（selectedFactorId）はその月の候補に無ければ候補先頭（自動選択）へ戻す。
 */
export const resolveBulkMonthFactors = async (args: {
  months: string[];
  location: ManualEntryLocationOption;
  energyType: EnergyType;
  fiscalYears: FiscalYearRange[];
  selection: BulkFactorSelectionState;
  fetchers?: BulkFactorFetchers;
}): Promise<Map<string, BulkMonthFactor>> => {
  const fetchers = args.fetchers ?? defaultFetchers;
  const providerCategory = isProviderCategory(args.energyType);

  const yearFactorsByKey = new Map<string, Promise<CandidateFactorRow[]>>();
  const providerFactorsByYear = new Map<number, Promise<CandidateFactorRow[]>>();

  const result = new Map<string, BulkMonthFactor>();
  for (const month of args.months) {
    const periodStart = `${month}-01`;
    const applicableYear = applicableYearForDate(args.fiscalYears, periodStart);
    const scope = {
      location: args.location,
      energyType: args.energyType,
      periodStart,
      applicableYear,
    };

    const years = withProvisionalYears(applicableYearsForRecord(periodStart, applicableYear));
    const yearsKey = years.join(',');
    if (!yearFactorsByKey.has(yearsKey)) {
      yearFactorsByKey.set(yearsKey, fetchers.fetchYearFactors(years));
    }
    const yearFactors = await yearFactorsByKey.get(yearsKey)!;

    let providerFactors: CandidateFactorRow[] = [];
    if (providerCategory) {
      const providerYear = deriveApplicableYear(periodStart);
      if (!providerFactorsByYear.has(providerYear)) {
        providerFactorsByYear.set(
          providerYear,
          fetchers.fetchProviderFactors(args.energyType, providerYear),
        );
      }
      const fetched = await providerFactorsByYear.get(providerYear)!;
      providerFactors = listApplicableProviderFactors(scope, yearFactors, fetched);
    }

    const providerSelected = args.selection.providerSelection.providerName !== null;
    const menuOptions = providerSelected
      ? listMenuOptions(providerFactors, args.selection.providerSelection)
      : [];
    const providerFactor = providerSelected
      ? resolveProviderFactor(menuOptions, args.selection.providerSelection.menuName)
      : null;
    const candidates = listEntryFactorCandidates(scope, yearFactors);
    const selectedFactor = resolveSelectedFactor({
      providerFactor,
      candidates,
      selectedFactorId: args.selection.selectedFactorId,
    });
    const factorIdToSave = selectedFactor?.id ?? null;

    result.set(month, {
      factorIdToSave,
      applied: resolveAppliedFactor({
        scope,
        yearFactors,
        providerFactors,
        providerLoadStatus: providerCategory ? 'ready' : 'none',
        providerNameSelected: providerSelected,
        factorIdToSave,
      }),
      // 事業者の係数行がこの月の年度に 1 つも無いときだけ（メニュー未選択で絞れない場合は含めない）。
      providerFellBack: providerSelected && menuOptions.length === 0,
    });
  }
  return result;
};
