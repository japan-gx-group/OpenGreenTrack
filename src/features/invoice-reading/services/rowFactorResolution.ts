// 一括登録の表の 1 行（1 明細）の排出係数を解決する（ブラウザ。係数マスタは factorSelectionService から読む）。
// 単月入力のフォーム（useScope12FactorSelection）・一括入力（bulkFactorResolution）と同じ純関数を通し、
// 表に出す係数・排出量と、保存した後の算定で使われる係数をずらさない。
// 行ごとに、選び直すための候補（事業者・メニュー・標準係数）と、保存する係数 ID・実際に適用される係数を返す。
// 係数マスタの取得は年度ごとに 1 回だけにする（FactorCatalog を表の全行で共有する）。

import {
  applicableYearsForRecord,
  deriveApplicableYear,
  withProvisionalYears,
} from '@/features/calculation/engine/resolveEmissionFactor';
import type { EnergyType } from '@/features/calculation/types';
import type { ManualEntryLocationOption } from '@/features/data-input/types';
import { isProviderCategory } from '@/features/data-input/services/entryCategory';
import {
  DEFAULT_PROVIDER_SELECTION,
  isAmbiguousEntryChoice,
  listApplicableProviderFactors,
  listEntryFactorCandidates,
  listMenuOptions,
  resolveAppliedFactor,
  resolveProviderFactor,
  resolveSelectedFactor,
  type AppliedFactorResolution,
} from '@/features/data-input/services/entryFactorSelection';
import {
  getActiveScope12Factors,
  getProviderFactors,
  type CandidateFactorRow,
} from '@/features/data-input/services/factorSelectionService';
import { applicableYearForDate, type FiscalYearRange } from '@/features/data-input/services/inlineCalculation';
import { buildProviderOptions, normalizeProviderName, type ProviderOption } from '@/features/data-input/services/providerOptions';

/** 係数マスタの取得（年度ごとに 1 回だけ。表の全行で共有する） */
export interface FactorCatalog {
  yearFactors: (applicableYears: number[]) => Promise<CandidateFactorRow[]>;
  providerFactors: (energyType: EnergyType, applicableYear: number) => Promise<CandidateFactorRow[]>;
}

export const createFactorCatalog = (
  fetchers: {
    fetchYearFactors: (applicableYears: number[]) => Promise<CandidateFactorRow[]>;
    fetchProviderFactors: (energyType: string, applicableYear: number) => Promise<CandidateFactorRow[]>;
  } = { fetchYearFactors: getActiveScope12Factors, fetchProviderFactors: getProviderFactors },
): FactorCatalog => {
  const years = new Map<string, Promise<CandidateFactorRow[]>>();
  const providers = new Map<string, Promise<CandidateFactorRow[]>>();
  const cached = (map: Map<string, Promise<CandidateFactorRow[]>>, key: string, load: () => Promise<CandidateFactorRow[]>) => {
    const hit = map.get(key);
    if (hit) return hit;
    // 失敗したら次に呼ばれたときに取り直せるよう、覚えた Promise を消す。
    const pending = load().catch((error: unknown) => {
      map.delete(key);
      throw error;
    });
    map.set(key, pending);
    return pending;
  };
  return {
    yearFactors: (applicableYears) =>
      cached(years, applicableYears.join(','), () => fetchers.fetchYearFactors(applicableYears)),
    providerFactors: (energyType, applicableYear) =>
      cached(providers, `${energyType}:${applicableYear}`, () => fetchers.fetchProviderFactors(energyType, applicableYear)),
  };
};

/** 行の係数の選び方（事業者別係数は名前、標準係数は名前か、選び直した ID） */
export interface RowFactorChoice {
  providerName: string | null;
  menuName: string | null;
  /** 請求書の読取りで決めた標準係数の名前（候補セレクトで選び直すまで使う） */
  factorName: string | null;
  /** 候補セレクトで選び直した標準係数の ID */
  selectedFactorId: string | null;
}

export interface RowFactorView {
  isProvider: boolean;
  providerOptions: ProviderOption[];
  /** 選んだ事業者のメニュー（1 つなら自動で決まる） */
  menuOptions: CandidateFactorRow[];
  /** 標準係数の候補（事業者を選ばないときは、電気・ガスの代替値もここに並ぶ） */
  candidates: CandidateFactorRow[];
  /** 事業者・メニューで決まった係数。決まらなければ null（代替値か、候補の先頭を使う） */
  providerFactor: CandidateFactorRow | null;
  /**
   * 候補セレクトで選ばれている係数。同じ優先度で名前の違う候補が並び（例: A重油・B・C重油）、まだ選んでいなければ
   * null（候補の先頭を当てずっぽうに選ばない。単月入力と同じ）
   */
  selectedFactor: CandidateFactorRow | null;
  factorIdToSave: string | null;
  applied: AppliedFactorResolution;
}

export const resolveRowFactor = async (args: {
  energyType: EnergyType;
  targetMonth: string;
  location: ManualEntryLocationOption;
  fiscalYears: FiscalYearRange[];
  choice: RowFactorChoice;
  catalog: FactorCatalog;
}): Promise<RowFactorView> => {
  const periodStart = `${args.targetMonth}-01`;
  const applicableYear = applicableYearForDate(args.fiscalYears, periodStart);
  const scope = { location: args.location, energyType: args.energyType, periodStart, applicableYear };
  const yearFactors = await args.catalog.yearFactors(withProvisionalYears(applicableYearsForRecord(periodStart, applicableYear)));

  const isProvider = isProviderCategory(args.energyType);
  const providerFactors = isProvider
    ? listApplicableProviderFactors(
        scope,
        yearFactors,
        await args.catalog.providerFactors(args.energyType, deriveApplicableYear(periodStart)),
      )
    : [];

  const providerName = args.choice.providerName ? normalizeProviderName(args.choice.providerName) : null;
  const selection = { ...DEFAULT_PROVIDER_SELECTION, providerName, menuName: args.choice.menuName };
  const menuOptions = providerName ? listMenuOptions(providerFactors, selection) : [];
  const providerFactor = providerName ? resolveProviderFactor(menuOptions, args.choice.menuName) : null;
  const candidates = listEntryFactorCandidates(scope, yearFactors);
  const selectedFactorId =
    args.choice.selectedFactorId ??
    (args.choice.factorName ? (candidates.find((factor) => factor.name === args.choice.factorName)?.id ?? null) : null);
  const selectedFactor = resolveSelectedFactor({
    providerFactor,
    candidates,
    selectedFactorId,
    ambiguous: isAmbiguousEntryChoice(scope, candidates),
  });
  const factorIdToSave = selectedFactor?.id ?? null;

  return {
    isProvider,
    providerOptions: buildProviderOptions(providerFactors),
    menuOptions,
    candidates,
    providerFactor,
    selectedFactor,
    factorIdToSave,
    applied: resolveAppliedFactor({
      scope,
      yearFactors,
      providerFactors,
      providerLoadStatus: isProvider ? 'ready' : 'none',
      providerNameSelected: providerName !== null,
      factorIdToSave,
    }),
  };
};
