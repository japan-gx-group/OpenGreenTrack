// 係数の判定（用途 invoice_factor_matching）に渡す候補を組み立てる（純関数・副作用なし）。
//
// 電気・都市ガスは事業者別係数。請求書の登録番号 → 事業者名の順で事業者を絞り、絞れた事業者はメニューまで候補にする。
// 絞れなければ、その年度のすべての事業者を候補にする（電気は約 560 社。メニューまで並べると約 1,200 行になるため、
// 事業者が多いときはメニューを並べず、選ばれた事業者のメニューはコードで決める: resolveFallbackMenu）。
// 基礎・調整後は 1 つの候補にまとめる（計算方法は請求書から決まらないため、フォームの選択に任せる）。
// 「(参考値)事業者全体」のメニューは算定に使うものではないため候補に入れない。
// 燃料は主要燃料 5 種の標準係数を候補にする。
// 渡す係数の行は、呼び出し側が対象年度の係数（暫定適用を含む）に絞っておく（filterApplicableFactors）。

import { MANUAL_ACTIVITY_CATEGORY_MAP } from '@/features/data-input/types';
import { normalizeProviderName } from '@/features/data-input/services/providerOptions';
import {
  INVOICE_FUEL_ENERGY_TYPES,
  type InvoiceFuelEnergyType,
} from '../types';

/** 候補の組み立てに使う係数の列（emission_factors の一部） */
export interface CandidateSourceRow {
  name: string;
  energyType: string;
  unit: string;
  factorValue: number;
  providerName: string | null;
  providerNumber: string | null;
  menuName: string | null;
}

export interface MenuCandidate {
  key: string;
  menuName: string;
}

export interface ProviderCandidate {
  key: string;
  providerName: string;
  /** 同じ事業者名に複数の登録番号がある場合はすべて */
  providerNumbers: string[];
  menus: MenuCandidate[];
}

export interface ProviderCandidateSet {
  kind: 'provider';
  energyType: 'electricity' | 'city_gas';
  /** どうやって事業者を絞ったか。null = 絞れず、すべての事業者を候補にした */
  narrowedBy: 'registration_number' | 'name' | null;
  providers: ProviderCandidate[];
  /** AI にメニューまで見せるか（事業者が多いときは見せない） */
  includeMenus: boolean;
}

export interface FuelCandidate {
  key: string;
  energyType: InvoiceFuelEnergyType;
  factorName: string;
  unit: string;
  factorValue: number;
}

export interface FuelCandidateSet {
  kind: 'fuel';
  fuels: FuelCandidate[];
}

export type FactorCandidateSet = ProviderCandidateSet | FuelCandidateSet;

/** メニューまで AI に見せる事業者の数の上限。都市ガス（約 10 社）はすべて見せ、電気の全事業者は見せない */
export const MAX_PROVIDERS_WITH_MENUS = 30;

const REFERENCE_MENU_PATTERN = /参考値/;

/** 事業者名の比べ方: 全角・半角と空白、会社の種類（株式会社など）の書き方の違いを無視する */
export const comparableProviderName = (name: string): string =>
  name
    .normalize('NFKC')
    .replace(/\s/g, '')
    .replace(/株式会社|有限会社|合同会社|一般社団法人|\(株\)|\(有\)|\(同\)|㈱|㈲/g, '')
    .toLowerCase();

/** 名前の部分一致で絞るときの最短の長さ（短い語で無関係な事業者まで拾わないため） */
const MIN_PARTIAL_NAME_LENGTH = 4;

const groupProviders = (rows: readonly CandidateSourceRow[], energyType: string): Omit<ProviderCandidate, 'key'>[] => {
  const byName = new Map<string, { numbers: string[]; menus: string[] }>();
  for (const row of rows) {
    if (row.energyType !== energyType) continue;
    const providerName = normalizeProviderName(row.providerName);
    if (!providerName) continue;
    const entry = byName.get(providerName) ?? { numbers: [], menus: [] };
    const number = row.providerNumber?.trim() ?? '';
    if (number && !entry.numbers.includes(number)) entry.numbers.push(number);
    const menu = row.menuName?.trim() ?? '';
    if (menu && !REFERENCE_MENU_PATTERN.test(menu) && !entry.menus.includes(menu)) entry.menus.push(menu);
    byName.set(providerName, entry);
  }
  return [...byName].map(([providerName, entry]) => ({
    providerName,
    providerNumbers: entry.numbers,
    menus: entry.menus.map((menuName) => ({ key: '', menuName })),
  }));
};

const narrowProviders = (
  providers: Omit<ProviderCandidate, 'key'>[],
  registrationNumber: string | null,
  supplierName: string | null,
): { providers: Omit<ProviderCandidate, 'key'>[]; narrowedBy: ProviderCandidateSet['narrowedBy'] } => {
  if (registrationNumber) {
    const byNumber = providers.filter((provider) => provider.providerNumbers.includes(registrationNumber));
    if (byNumber.length > 0) return { providers: byNumber, narrowedBy: 'registration_number' };
  }
  if (supplierName) {
    const target = comparableProviderName(supplierName);
    const exact = providers.filter((provider) => comparableProviderName(provider.providerName) === target);
    if (exact.length > 0) return { providers: exact, narrowedBy: 'name' };
    if (target.length >= MIN_PARTIAL_NAME_LENGTH) {
      const partial = providers.filter((provider) => {
        const name = comparableProviderName(provider.providerName);
        return name.length >= MIN_PARTIAL_NAME_LENGTH && (name.includes(target) || target.includes(name));
      });
      if (partial.length > 0 && partial.length <= 3) return { providers: partial, narrowedBy: 'name' };
    }
  }
  return { providers, narrowedBy: null };
};

/** 電気・都市ガスの候補。事業者別係数の行が無ければ providers は空 */
export const buildProviderCandidates = (args: {
  energyType: 'electricity' | 'city_gas';
  rows: readonly CandidateSourceRow[];
  registrationNumber: string | null;
  supplierName: string | null;
}): ProviderCandidateSet => {
  const grouped = groupProviders(args.rows, args.energyType);
  const { providers, narrowedBy } = narrowProviders(grouped, args.registrationNumber, args.supplierName);
  return {
    kind: 'provider',
    energyType: args.energyType,
    narrowedBy,
    includeMenus: providers.length <= MAX_PROVIDERS_WITH_MENUS,
    providers: providers.map((provider, providerIndex) => {
      const key = `p${providerIndex + 1}`;
      return {
        ...provider,
        key,
        menus: provider.menus.map((menu, menuIndex) => ({ key: `${key}-m${menuIndex + 1}`, menuName: menu.menuName })),
      };
    }),
  };
};

const isInvoiceFuelEnergyType = (value: string): value is InvoiceFuelEnergyType =>
  (INVOICE_FUEL_ENERGY_TYPES as readonly string[]).includes(value);

/** 燃料の候補（主要燃料 5 種の標準係数。同じ種別・同じ名前の行は 1 つにまとめる） */
export const buildFuelCandidates = (rows: readonly CandidateSourceRow[]): FuelCandidateSet => {
  const fuels: FuelCandidate[] = [];
  for (const row of rows) {
    if (!isInvoiceFuelEnergyType(row.energyType) || row.providerName !== null) continue;
    if (fuels.some((fuel) => fuel.energyType === row.energyType && fuel.factorName === row.name)) continue;
    fuels.push({
      key: `f${fuels.length + 1}`,
      energyType: row.energyType,
      factorName: row.name,
      unit: row.unit,
      factorValue: row.factorValue,
    });
  }
  return { kind: 'fuel', fuels };
};

/** AI に見せる候補の文（1 行 1 候補）。キーは AI が返す値 */
export const formatCandidateLines = (set: FactorCandidateSet): string[] => {
  if (set.kind === 'fuel') {
    return set.fuels.map(
      (fuel) =>
        `${fuel.key}: [${MANUAL_ACTIVITY_CATEGORY_MAP[fuel.energyType].labelJP}] ${fuel.factorName}（${fuel.factorValue} ${fuel.unit}）`,
    );
  }
  return set.providers.flatMap((provider) => {
    const numbers = provider.providerNumbers.length > 0 ? `（登録番号 ${provider.providerNumbers.join(' / ')}）` : '';
    const head = `${provider.key}: ${provider.providerName}${numbers}`;
    if (!set.includeMenus) return [head];
    return [head, ...provider.menus.map((menu) => `  ${menu.key}: メニュー「${menu.menuName}」`)];
  });
};

/**
 * 候補のキーと、画面に出せる名前の対応。AI に見せたキーだけを入れる（AI が返したキーの確認と、
 * 判断の文に残ったキーを名前に置き換えるのに使う）。燃料は係数の名前、事業者は事業者名、メニューは事業者名とメニュー名。
 */
export const candidateLabelsOf = (set: FactorCandidateSet): Map<string, string> =>
  new Map(
    set.kind === 'fuel'
      ? set.fuels.map((fuel) => [fuel.key, fuel.factorName])
      : set.providers.flatMap((provider) => [
          [provider.key, provider.providerName] as const,
          ...(set.includeMenus
            ? provider.menus.map((menu) => [menu.key, `${provider.providerName}の「${menu.menuName}」`] as const)
            : []),
        ]),
  );

/**
 * メニューを AI に見せなかった（事業者が多い）か、AI が事業者だけを選んだときのメニュー。
 * 公表メニューが 1 つだけならそれを使う。複数あれば、料金メニューから決められないので null（人が選ぶ）。
 */
export const resolveFallbackMenu = (provider: ProviderCandidate): string | null =>
  provider.menus.length === 1 ? provider.menus[0].menuName : null;
