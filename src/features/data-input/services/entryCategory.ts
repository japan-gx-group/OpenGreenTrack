// 統合データ入力フォーム（ActivityEntryForm）のカテゴリ判定（純関数・副作用なし）。
// Scope 1・2・3 の活動量を同じフォーマットで入力するため、選択したカテゴリから
//   - 保存経路（Scope1/2 = emission_factors 参照 / Scope3 積上げ = IDEA 参照）
//   - 排出係数の参照方式（供給事業者別係数 / 標準係数 / IDEA 原単位）
//   - 活動量の単位の出所（カテゴリ既定 / 記録の単位 / 選択製品の単位）
// をここで一意に決める。UI はこの結果を表示・切替に使うだけで独自の判定を持たない。
// MANUAL_ACTIVITY_CATEGORIES / MANUAL_ACTIVITY_CATEGORY_MAP はここでは変更しない（types.test.ts が固定。
// scope3_activity は手動カテゴリ定数には足さず、フォーム側の選択肢としてのみ組み立てる）。

import {
  normalizeUnit,
  resolveUnitConversion,
  splitFactorUnit,
} from '@/features/calculation/engine/units';
import { ENERGY_TYPES, type EnergyType } from '@/features/calculation/types';
import {
  SCOPE3_CATEGORY_IDS,
  SCOPE3_CATEGORY_NAMES,
} from '@/features/scope-analysis/services/scopeAnalysisService';
import {
  MANUAL_ACTIVITY_CATEGORIES,
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ActivityEntryInitialValues,
  type SavedManualActivityRecord,
} from '../types';

/** フォーム内部のカテゴリ。energy = Scope1/2（EnergyType）、scope3 = Scope3 積上げ（カテゴリ 1〜15）。 */
export type EntryCategory =
  | { kind: 'energy'; energyType: EnergyType }
  | { kind: 'scope3'; categoryId: number };

/** 保存経路。activityRecordService の add/updateManual（scope12）と add/updateScope3（scope3）に 1:1 で対応する。 */
export type EntryPath = 'scope12' | 'scope3';

/**
 * 排出係数の参照方式。カテゴリから一意に決まる（ユーザーは選ばない）。
 *   provider: 供給事業者別係数（計算方法 → 供給事業者 → メニュー。未選択なら代替値）
 *   standard: 標準係数（listFactorCandidates の候補。先頭が自動選択）
 *   idea:     IDEA 原単位（製品検索。単位は製品から自動設定）
 */
export type FactorSource = 'provider' | 'standard' | 'idea';

/** 計算方法（供給事業者別係数の係数種別）。adjusted = 調整後排出係数 / basic = 基礎排出係数。 */
export type FactorTypeChoice = 'adjusted' | 'basic';

/** フォームのモード。'create'（新規入力）または 'edit'（履歴編集モーダル内に埋め込む）。 */
export type EntryMode = 'create' | 'edit';

// 供給事業者別排出係数（環境省・経産省公表）を持つカテゴリ。
// 計算方法（基礎/調整後）→ 供給事業者 → メニュー の順に選ぶと係数が確定する。
export const PROVIDER_CATEGORIES = ['electricity', 'city_gas', 'heat'] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export const isProviderCategory = (energyType: EnergyType): energyType is ProviderCategory =>
  (PROVIDER_CATEGORIES as readonly string[]).includes(energyType);

/** 新規入力の既定カテゴリ。 */
export const DEFAULT_ENTRY_CATEGORY: EntryCategory = { kind: 'energy', energyType: 'electricity' };

export const entryPathOf = (category: EntryCategory): EntryPath =>
  category.kind === 'scope3' ? 'scope3' : 'scope12';

export const factorSourceOf = (category: EntryCategory): FactorSource => {
  if (category.kind === 'scope3') {
    return 'idea';
  }
  return isProviderCategory(category.energyType) ? 'provider' : 'standard';
};

export const isSameEntryCategory = (a: EntryCategory, b: EntryCategory): boolean =>
  a.kind === 'energy'
    ? b.kind === 'energy' && a.energyType === b.energyType
    : b.kind === 'scope3' && a.categoryId === b.categoryId;

const ENERGY_VALUE_PREFIX = 'energy:';
const SCOPE3_VALUE_PREFIX = 'scope3:';

/** `<option value>` の形式。'energy:electricity' / 'scope3:1' */
export const formatEntryCategoryValue = (category: EntryCategory): string =>
  category.kind === 'energy'
    ? `${ENERGY_VALUE_PREFIX}${category.energyType}`
    : `${SCOPE3_VALUE_PREFIX}${category.categoryId}`;

/** 不正な値（未知の EnergyType・範囲外のカテゴリ番号・形式違い）は null。 */
export const parseEntryCategoryValue = (value: string): EntryCategory | null => {
  if (value.startsWith(ENERGY_VALUE_PREFIX)) {
    const energyType = value.slice(ENERGY_VALUE_PREFIX.length);
    // scope3_activity は EnergyType に含まれるが Scope1/2 経路の値としては不正（Scope3 は 'scope3:<n>' で表す）。
    return (ENERGY_TYPES as readonly string[]).includes(energyType) && energyType !== 'scope3_activity'
      ? { kind: 'energy', energyType: energyType as EnergyType }
      : null;
  }
  if (value.startsWith(SCOPE3_VALUE_PREFIX)) {
    const raw = value.slice(SCOPE3_VALUE_PREFIX.length);
    const categoryId = Number(raw);
    return /^\d+$/.test(raw) && SCOPE3_CATEGORY_IDS.includes(categoryId)
      ? { kind: 'scope3', categoryId }
      : null;
  }
  return null;
};

/** Scope3 カテゴリの表示ラベル（例 'カテゴリ1: 購入した製品・サービス'）。履歴表示と同じ書式。 */
export const scope3CategoryLabel = (categoryId: number): string =>
  `カテゴリ${categoryId}: ${SCOPE3_CATEGORY_NAMES[categoryId] ?? ''}`;

/** 選択肢・プレビューの表示ラベル。energy は labelJP（'電気'）、scope3 は 'カテゴリN: 名称'。 */
export const entryCategoryLabel = (category: EntryCategory): string =>
  category.kind === 'energy'
    ? MANUAL_ACTIVITY_CATEGORY_MAP[category.energyType].labelJP
    : scope3CategoryLabel(category.categoryId);

/** 排出係数の参照方式の表示ラベル（カテゴリ直下のチップ・プレビュー行で共用）。 */
export const FACTOR_SOURCE_MODE_LABELS: Record<FactorSource, string> = {
  provider: '供給事業者別係数',
  standard: '標準係数',
  idea: 'IDEA 原単位',
};

/**
 * 保存経路の表示ラベル（編集時の注記で使う）。
 * 「Scope 1・2」とは書かない: 廃棄物・出張通勤などは Scope 3 の活動量だが排出係数マスタで算定する scope12 経路のため。
 */
export const ENTRY_PATH_LABELS: Record<EntryPath, string> = {
  scope12: '排出係数マスタで算定するカテゴリ',
  scope3: 'IDEA 原単位で積み上げるカテゴリ',
};

/**
 * カテゴリ選択肢の optgroup。参照方式ごとに束ねて「どの係数で算定されるか」が選ぶ時点で分かるようにする。
 * ラベルは <optgroup label> にそのまま出す。
 */
export const ENTRY_CATEGORY_GROUP_LABELS: Record<FactorSource, string> = {
  provider: '供給事業者別係数（電気・都市ガス・熱）',
  standard: '標準係数（燃料・廃棄物・出張・通勤）',
  idea: 'IDEA 原単位（Scope 3 積上げ・カテゴリ1〜15）',
};

export interface EntryCategoryOption {
  /** formatEntryCategoryValue の結果 */
  value: string;
  /** entryCategoryLabel の結果 */
  label: string;
  category: EntryCategory;
}

export interface EntryCategoryGroup {
  id: FactorSource;
  label: string;
  path: EntryPath;
  /** 編集モードで初期値と保存経路（path）が異なる群は選択不可（<optgroup disabled>）。 */
  disabled: boolean;
  options: EntryCategoryOption[];
}

const toOption = (category: EntryCategory): EntryCategoryOption => ({
  value: formatEntryCategoryValue(category),
  label: entryCategoryLabel(category),
  category,
});

/**
 * カテゴリ選択肢を組み立てる。
 * 新規入力は手動カテゴリ（MANUAL_ACTIVITY_CATEGORIES の 7 件。定数の順序を保つ）を参照方式で 2 群に分け、
 * Scope3 積上げの 15 カテゴリを 3 群目に並べる。
 * 編集で手動カテゴリ外（燃料種別など取込レコード）を開いた場合は、その種別も選べるよう
 * 標準係数群の先頭に足す。編集では保存経路をまたぐ群を disabled にする（サービスに更新経路が無いため）。
 */
export const buildEntryCategoryGroups = (params: {
  mode: EntryMode;
  initialCategory: EntryCategory | null;
}): EntryCategoryGroup[] => {
  const { mode, initialCategory } = params;
  const lockedPath = mode === 'edit' && initialCategory ? entryPathOf(initialCategory) : null;
  const isDisabled = (path: EntryPath) => lockedPath !== null && lockedPath !== path;

  const manual = [...MANUAL_ACTIVITY_CATEGORIES] as EnergyType[];
  const providerTypes = manual.filter((energyType) => isProviderCategory(energyType));
  const standardTypes: EnergyType[] = manual.filter((energyType) => !isProviderCategory(energyType));
  if (
    initialCategory?.kind === 'energy' &&
    !manual.includes(initialCategory.energyType)
  ) {
    standardTypes.unshift(initialCategory.energyType);
  }

  return [
    {
      id: 'provider',
      label: ENTRY_CATEGORY_GROUP_LABELS.provider,
      path: 'scope12',
      disabled: isDisabled('scope12'),
      options: providerTypes.map((energyType) => toOption({ kind: 'energy', energyType })),
    },
    {
      id: 'standard',
      label: ENTRY_CATEGORY_GROUP_LABELS.standard,
      path: 'scope12',
      disabled: isDisabled('scope12'),
      options: standardTypes.map((energyType) => toOption({ kind: 'energy', energyType })),
    },
    {
      id: 'idea',
      label: ENTRY_CATEGORY_GROUP_LABELS.idea,
      path: 'scope3',
      disabled: isDisabled('scope3'),
      options: SCOPE3_CATEGORY_IDS.map((categoryId) => toOption({ kind: 'scope3', categoryId })),
    },
  ];
};

// SavedManualActivityRecord → 編集フォームの初期値。対象月は periodStart の YYYY-MM。
// Scope3積上げ行は scope3CategoryId / ideaFactorId を渡す（scope3CategoryId が null なら 1、
// ideaFactorId は null のまま渡し、参照切れはフォーム側で再選択を促す）。
// Scope1/2 行は保存済みの unit をそのまま渡す（取込レコードの単位を編集で上書きしないため）。
export const toActivityEntryInitialValues = (
  record: SavedManualActivityRecord,
): ActivityEntryInitialValues =>
  record.energyType === 'scope3_activity'
    ? {
        kind: 'scope3',
        locationId: record.locationId,
        locationName: record.locationName,
        scope3CategoryId: record.scope3CategoryId ?? 1,
        ideaFactorId: record.ideaFactorId,
        targetMonth: record.periodStart.slice(0, 7),
        amount: String(record.amount),
        note: record.note ?? '',
      }
    : {
        kind: 'scope12',
        locationId: record.locationId,
        locationName: record.locationName,
        energyType: record.energyType,
        unit: record.unit,
        targetMonth: record.periodStart.slice(0, 7),
        amount: String(record.amount),
        note: record.note ?? '',
        emissionFactorId: record.emissionFactorId,
      };

/** 履歴編集の初期値 → フォーム内部のカテゴリ。 */
export const entryCategoryFromInitialValues = (
  initial: ActivityEntryInitialValues | undefined,
): EntryCategory | null => {
  if (!initial) {
    return null;
  }
  return initial.kind === 'scope3'
    ? { kind: 'scope3', categoryId: initial.scope3CategoryId }
    : { kind: 'energy', energyType: initial.energyType };
};

/** 活動量の単位の決定結果。Scope1/2 は常に確定、Scope3 は製品未確定なら null。 */
export type EntryUnit =
  | {
      kind: 'energy';
      unit: string;
      /** MANUAL_ACTIVITY_CATEGORY_MAP[energyType].unit */
      standardUnit: string;
      /** 記録の単位が標準単位と異なる（取込レコード）。警告表示に使う。 */
      isNonStandard: boolean;
      /** 標準単位では係数へ換算できず、適用係数の分母単位を採った（ヒント表示に使う）。 */
      isFactorDerived: boolean;
    }
  | { kind: 'scope3'; unit: string | null };

/**
 * 活動量の単位の決定順:
 *   1. Scope3 → 選択製品の unit（未取得なら null。製品から自動設定・編集不可）
 *   2. 編集かつカテゴリが初期値と同じ → 記録の unit（取込レコードの 'MWh' / '円' 等をそのまま保持）
 *   3. 標準単位（MANUAL_ACTIVITY_CATEGORY_MAP[energyType].unit）が適用係数の単位へ換算できない
 *      → 係数の分母単位（例: 通勤の標準単位 '人・日' に対しカスタム係数が 't-CO2e/km' なら 'km'、
 *        出張の標準単位 '人・日' に対し公式係数「交通費支給額 旅客鉄道」kg-CO2/円 なら '円'）。
 *      seed の Scope3 標準係数は 円 / 人・日 / 人・年 / t-km など標準単位と異なる分母を持つものがあり、
 *      標準単位のままだと保存後に必ず UNIT_MISMATCH で未算定になるため、IDEA 経路が製品から単位を
 *      決めるのと同様に係数から決める。換算できる組み合わせ（L と tCO2/kL など）は標準単位を優先する
 *   4. それ以外 → 標準単位
 * 編集でカテゴリを変えたら標準単位になり、元のカテゴリへ戻せば記録の単位に戻る（派生値なので state を持たない）。
 */
export const resolveEntryUnit = (params: {
  category: EntryCategory;
  mode: EntryMode;
  /** scope12 の編集初期値。それ以外（新規・scope3）は null。 */
  initial: { energyType: EnergyType; unit: string } | null;
  productUnit: string | null;
  /** 保存後に適用される係数の unit（'kg-CO2/人・日' 等）。未確定なら null。 */
  factorUnit?: string | null;
}): EntryUnit => {
  const { category, mode, initial, productUnit, factorUnit = null } = params;
  if (category.kind === 'scope3') {
    return { kind: 'scope3', unit: productUnit };
  }
  const standardUnit = MANUAL_ACTIVITY_CATEGORY_MAP[category.energyType].unit;
  const keepRecordUnit =
    mode === 'edit' && initial !== null && initial.energyType === category.energyType;
  if (keepRecordUnit) {
    // 表記ゆれ（m3 / m³ / ㎥ など）は算定エンジンと同じ正規化で同一視し、「取込データ」の警告を出さない。
    return {
      kind: 'energy',
      unit: initial.unit,
      standardUnit,
      isNonStandard: normalizeUnit(initial.unit) !== normalizeUnit(standardUnit),
      isFactorDerived: false,
    };
  }
  const factorDenominator =
    factorUnit !== null && resolveUnitConversion(standardUnit, factorUnit) === null
      ? (splitFactorUnit(factorUnit)?.denominator ?? null)
      : null;
  return {
    kind: 'energy',
    unit: factorDenominator ?? standardUnit,
    standardUnit,
    isNonStandard: false,
    isFactorDerived: factorDenominator !== null,
  };
};
