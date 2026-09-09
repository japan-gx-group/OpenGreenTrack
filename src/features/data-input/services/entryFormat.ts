// 統合データ入力フォームの表示整形（純関数・副作用なし）。
// 排出量・係数・出典の表示文字列と、計算結果ブロック・プレビュー行の内容をここに集約し、
// フォーム本体・係数セクション・プレビューモーダルで共用する。

import type { SearchableSelectOption } from '@/components/ui/searchableSelectFilter';
import {
  toIdeaProductOptions,
  type IdeaProduct,
  type IdeaProductDetail,
} from '@/features/factors/services/ideaProductSearch';
import type { ManualEntryPeriodDates } from './manualEntryTargetMonth';
import {
  FACTOR_SOURCE_MODE_LABELS,
  entryCategoryLabel,
  type EntryCategory,
  type FactorSource,
} from './entryCategory';
import { FACTOR_SOURCE_LABELS, type CandidateFactorRow } from './factorSelectionService';
import { toIdeaFactorValue } from './scope3InlineCalculation';

/** 排出量（t-CO2e）の表示。表示は小数第3位、保存値は算定エンジンと同じ第6位で確定する。 */
export const formatEmissions = (value: number): string =>
  value.toLocaleString('ja-JP', { maximumFractionDigits: 3 });

/** 係数の表示（例 '0.000416 t-CO2/kWh'）。 */
export const factorValueText = (factor: CandidateFactorRow): string =>
  `${factor.factorValue} ${factor.unit}`;

/** 係数の名称と値（例 '電気（代替値・全国）（0.000416 t-CO2/kWh）'）。プレビュー行・候補 option で共用。 */
export const factorNameWithValue = (factor: CandidateFactorRow): string =>
  `${factor.name}（${factorValueText(factor)}）`;

/** 係数の出典（発行元 + 公表資料名）。 */
export const factorSourceText = (factor: CandidateFactorRow): string => {
  const sourceLabel = FACTOR_SOURCE_LABELS[factor.source] ?? factor.source;
  return factor.sourceDocumentName ? `${sourceLabel}（${factor.sourceDocumentName}）` : sourceLabel;
};

/** 係数の事業者（メニュー付き）または地域。 */
export const factorProviderOrRegionText = (factor: CandidateFactorRow): { label: string; value: string } =>
  factor.providerName
    ? {
        label: '事業者',
        value: `${factor.providerName}${factor.menuName ? `（${factor.menuName}）` : ''}`,
      }
    : { label: '地域', value: factor.regionName };

/** IDEA 原単位の表示（例 '0.123 kg-CO2e/kg'）。表示のみに使い、計算は computeEstimatedScope3Emissions を通す。 */
export const ideaFactorValueText = (detail: IdeaProductDetail): string =>
  `${toIdeaFactorValue(detail)} kg-CO2e/${detail.unit}`;

/** IDEA の出典表記（例 'AIST-IDEA Ver.4.0 標準版'）。 */
export const ideaSourceText = (detail: IdeaProductDetail): string =>
  `AIST-IDEA${detail.importVersion ? ` ${detail.importVersion}` : ''}`;

/** IDEA 製品の表示（例 '鋼材（JPN / kg）'）。検索候補のラベルと同じ書式。 */
export const ideaProductText = (detail: IdeaProductDetail): string =>
  `${detail.productName}（${detail.country} / ${detail.unit}）`;

// SearchableSelect の候補。選択済み製品が検索結果に含まれない場合（編集の初期表示・
// 検索し直した直後）でもラベルが消えないよう、選択中の製品を先頭に補う。
export const buildIdeaSelectOptions = (
  products: readonly IdeaProduct[],
  productDetail: IdeaProductDetail | null,
  selectedProductId: string | null,
): SearchableSelectOption[] => {
  const options = toIdeaProductOptions(products);
  if (
    productDetail &&
    selectedProductId === productDetail.id &&
    !options.some((option) => option.value === productDetail.id)
  ) {
    return [...toIdeaProductOptions([productDetail]), ...options];
  }
  return options;
};

/** 活動量ラベル。単位が '円' の行（金額で登録する費目）は「金額」表記にする。 */
export const amountFieldLabel = (unit: string | null): string =>
  unit === '円' ? '金額（活動量として保存）' : '活動量';

export type CalculationResultView =
  | { kind: 'idle'; message: string }
  | { kind: 'unit-mismatch'; message: string }
  | { kind: 'result'; amountText: string; unit: string; factorText: string; emissionsText: string };

/**
 * 計算結果ブロックの表示内容。係数（または製品）が確定 → 活動量あり → 単位換算可 の順に判定する。
 * Scope1/2 は「保存後に実際に適用される係数」（appliedFactor）を基準にし、プレビューと算定結果を一致させる。
 */
export const buildCalculationResultView = (args: {
  factorSource: FactorSource;
  /** 対象年月が検証を通っている。false のときは係数・製品より先に案内を出す */
  hasPeriod: boolean;
  amount: number | null;
  unit: string | null;
  /** Scope1/2: 標準係数を取得済みで候補判定ができる。IDEA: 常に true */
  factorsReady: boolean;
  appliedFactor: CandidateFactorRow | null;
  /** Scope1/2: 同順位の候補が複数あり自動では決められない（appliedFactor は null） */
  factorAmbiguous?: boolean;
  productDetail: IdeaProductDetail | null;
  estimatedEmissions: number | null;
}): CalculationResultView => {
  if (!args.hasPeriod) {
    return { kind: 'idle', message: '対象年月を正しく選択すると計算結果を表示します。' };
  }
  if (args.factorSource === 'idea') {
    if (!args.productDetail) {
      return { kind: 'idle', message: 'IDEA製品を選択すると計算結果を表示します。' };
    }
  } else if (!args.factorsReady) {
    return { kind: 'idle', message: '適用する排出係数が確定すると計算結果を表示します。' };
  } else if (!args.appliedFactor) {
    return {
      kind: 'idle',
      message: args.factorAmbiguous
        ? '該当する排出係数が複数あるため、候補から排出係数を選択すると計算結果を表示します。'
        : '適用できる排出係数が無いため計算できません。このまま保存した場合、排出量は未算定として記録されます。',
    };
  }
  if (args.amount === null || args.unit === null) {
    return { kind: 'idle', message: '活動量を入力すると計算結果を表示します。' };
  }
  if (args.estimatedEmissions === null) {
    return {
      kind: 'unit-mismatch',
      message:
        args.factorSource === 'idea'
          ? `この製品の単位「${args.unit}」では排出量を計算できません。`
          : `活動量の単位「${args.unit}」を係数の単位「${args.appliedFactor?.unit ?? ''}」に換算できないため計算できません。このまま保存した場合、排出量は未算定として記録されます。`,
    };
  }
  return {
    kind: 'result',
    amountText: args.amount.toLocaleString(),
    unit: args.unit,
    factorText:
      args.factorSource === 'idea' && args.productDetail
        ? ideaFactorValueText(args.productDetail)
        : args.appliedFactor
          ? factorValueText(args.appliedFactor)
          : '',
    emissionsText: `${formatEmissions(args.estimatedEmissions)} t-CO2e`,
  };
};

export interface PreviewRow {
  label: string;
  value: string;
  /** 2 行目に薄く出す補足（出典・事業者・地域 / IDEA の原単位と版 / 単位の注記）。 */
  note?: string;
}

/** 係数の参照方式行の値（自動選択か手動変更か、事業者未選択の代替値かを補足する）。 */
export const factorSourceRowText = (args: {
  factorSource: FactorSource;
  /** provider: 供給事業者を選択して係数が確定している */
  isProviderFactorSelected: boolean;
  /** standard: 適用される係数が候補先頭（自動選択）ではない（候補から変更した・編集で別の候補が保存されていた） */
  isCandidateOverridden: boolean;
  /** 係数の取得失敗で判定できず、保存されている係数指定をそのまま維持して保存する */
  isSavedFactorKeptUnknown: boolean;
}): string => {
  const base = FACTOR_SOURCE_MODE_LABELS[args.factorSource];
  if (args.factorSource === 'idea') {
    return base;
  }
  if (args.isSavedFactorKeptUnknown) {
    return `${base}（保存されている係数指定を維持）`;
  }
  if (args.factorSource === 'provider' && !args.isProviderFactorSelected) {
    return `${base}（供給事業者未選択のため代替値）`;
  }
  if (args.factorSource === 'standard') {
    return `${base}（${args.isCandidateOverridden ? '候補から変更' : '自動選択'}）`;
  }
  return base;
};

/** プレビューモーダルの行。Scope 1・2・3 で同じ 8 行（IDEA は「適用係数」行に製品と原単位を出す）。 */
export const buildPreviewRows = (args: {
  category: EntryCategory;
  factorSource: FactorSource;
  locationName: string | null;
  period: ManualEntryPeriodDates;
  amount: number;
  unit: string;
  isNonStandardUnit: boolean;
  note: string;
  factorSourceText: string;
  appliedFactor: CandidateFactorRow | null;
  /** 保存する係数 id が前提フィルタ不一致で自動選択へ落ちる（読み替えできた場合は含まない） */
  willFallBackFromSavedFactor: boolean;
  /** 保存する係数 id（事業者別係数）が年度更新で入れ替わり、同一事業者・同一メニューの当年度行へ読み替えられる */
  savedFactorRemapped?: boolean;
  /** 編集で係数 UI に触れておらず、保存されていた係数指定をそのまま送る（フォールバック注記の文言に使う） */
  savedFactorKept: boolean;
  /** 係数の取得失敗で適用係数を判定できない（provider = 事業者リスト / standard = 標準係数）。null なら判定済み */
  appliedFactorUnknown: 'provider' | 'standard' | null;
  productDetail: IdeaProductDetail | null;
  estimatedEmissions: number | null;
}): PreviewRow[] => {
  const isIdea = args.factorSource === 'idea';
  const rows: PreviewRow[] = [
    { label: '拠点名', value: args.locationName ?? '—' },
    { label: 'カテゴリ', value: entryCategoryLabel(args.category) },
    { label: '対象期間', value: `${args.period.start} ～ ${args.period.end}` },
    {
      label: '活動量',
      value: `${args.amount.toLocaleString()} ${args.unit}`,
      note: args.isNonStandardUnit ? '記録の単位（取込データ）をそのまま保持します' : undefined,
    },
    { label: '係数の参照方式', value: args.factorSourceText },
  ];
  if (isIdea) {
    rows.push({
      label: '適用係数',
      value: args.productDetail ? ideaProductText(args.productDetail) : '—',
      note: args.productDetail
        ? `原単位: ${ideaFactorValueText(args.productDetail)} / 出典: ${ideaSourceText(args.productDetail)}`
        : undefined,
    });
  } else if (args.appliedFactorUnknown === 'provider') {
    rows.push({
      label: '適用係数',
      value: '—（事業者リストを取得できないため確認できません。元の係数指定を維持して保存します）',
    });
  } else if (args.appliedFactorUnknown === 'standard') {
    rows.push({
      label: '適用係数',
      value: '—（排出係数を取得できないため確認できません。保存後の算定で自動解決します）',
    });
  } else if (args.appliedFactor) {
    const providerOrRegion = factorProviderOrRegionText(args.appliedFactor);
    rows.push({
      label: '適用係数',
      value: `${factorNameWithValue(args.appliedFactor)}${
        args.savedFactorRemapped
          ? '（保存されていた係数は年度更新で入れ替わったため、同じ事業者の現在の係数を適用）'
          : args.willFallBackFromSavedFactor
            ? args.savedFactorKept
              ? '（保存されていた係数は適用できないため自動選択）'
              : '（選択した係数は有効期間外のため自動選択）'
            : ''
      }`,
      note: `出典: ${factorSourceText(args.appliedFactor)} / ${providerOrRegion.label}: ${providerOrRegion.value}`,
    });
  } else {
    rows.push({ label: '適用係数', value: '—（適用できる係数が無いため未算定として保存されます）' });
  }
  rows.push(
    {
      label: '推定排出量',
      value: args.estimatedEmissions !== null ? `${formatEmissions(args.estimatedEmissions)} t-CO2e` : '—',
    },
    { label: '備考', value: args.note || '—' },
  );
  return rows;
};
