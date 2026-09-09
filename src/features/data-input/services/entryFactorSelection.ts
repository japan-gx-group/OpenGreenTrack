// 統合データ入力フォームの Scope1/2 係数選択（純関数・副作用なし）。
// 供給事業者別係数の絞り込み・編集時の復元、標準係数の候補、保存する係数 ID、
// 「保存後の算定で実際に適用される係数」の判定をここに集約する。
// 候補の優先順位・前提フィルタは算定エンジン（listFactorCandidates / resolveEmissionFactor）を
// そのまま使い、プレビューと算定バッチの結果がずれないようにする。

import { REGION_LABELS } from '@/types/region';
import {
  filterApplicableFactors,
  listFactorCandidates,
  isProvisionalFactor,
  resolveEmissionFactorDetailed,
} from '@/features/calculation/engine/resolveEmissionFactor';
import type { EnergyType } from '@/features/calculation/types';
import type { ManualEntryLocationOption } from '../types';
import type { FactorTypeChoice } from './entryCategory';
import type { CandidateFactorRow } from './factorSelectionService';
import { normalizeProviderName } from './providerOptions';

/** 供給事業者別係数 UI の選択状態（計算方法 → 供給事業者 → メニュー）。 */
export interface ProviderSelection {
  factorType: FactorTypeChoice;
  /** normalizeProviderName 済みの事業者名（buildProviderOptions の value と同じ正規化）。null = 未選択 */
  providerName: string | null;
  menuName: string | null;
}

export const DEFAULT_PROVIDER_SELECTION: ProviderSelection = {
  factorType: 'adjusted',
  providerName: null,
  menuName: null,
};

// 選択中の事業者×計算方法のメニュー候補。選択肢の value は正規化済みの事業者名なので、
// 突き合わせも同じ正規化を通す。
export const listMenuOptions = (
  providerFactors: readonly CandidateFactorRow[],
  selection: ProviderSelection,
): CandidateFactorRow[] => {
  if (selection.providerName === null) {
    return [];
  }
  return providerFactors.filter(
    (factor) =>
      normalizeProviderName(factor.providerName) === selection.providerName &&
      factor.factorType === selection.factorType,
  );
};

// 事業者選択で確定した係数。メニュー候補が 1 件だけなら自動確定し、複数ある場合は選択済みメニューで絞る。
export const resolveProviderFactor = (
  menuOptions: readonly CandidateFactorRow[],
  menuName: string | null,
): CandidateFactorRow | null => {
  if (menuOptions.length === 0) {
    return null;
  }
  if (menuOptions.length === 1) {
    return menuOptions[0];
  }
  return menuOptions.find((factor) => factor.menuName === menuName) ?? null;
};

/**
 * 編集で開いたレコードの係数指定（emissionFactorId）が事業者別係数なら、取得済みの事業者係数行から
 * 計算方法 / 供給事業者 / メニュー の選択状態を復元する。
 * 行が無い（標準係数・年度不一致・archived・取得失敗）または factorType が null（UI に写像できない）場合は null。
 * 復元は派生値として扱い、ユーザーが事業者 UI を操作するまで有効（復元で factorTouched は立たない）。
 */
export const restoreProviderSelection = (
  providerFactors: readonly CandidateFactorRow[],
  factorId: string | null,
): ProviderSelection | null => {
  if (factorId === null) {
    return null;
  }
  const row = providerFactors.find((factor) => factor.id === factorId);
  if (!row || row.factorType === null) {
    return null;
  }
  return {
    factorType: row.factorType,
    providerName: normalizeProviderName(row.providerName),
    menuName: row.menuName,
  };
};

/** 係数解決の入力条件（拠点・種別・対象月・適用年度）。 */
export interface FactorResolutionScope {
  location: ManualEntryLocationOption;
  energyType: EnergyType;
  periodStart: string;
  applicableYear: number;
}

const toResolutionContext = (scope: FactorResolutionScope) => ({
  applicableYear: scope.applicableYear,
  regionName: REGION_LABELS[scope.location.region] ?? null,
});

/**
 * 取得した事業者係数行のうち、この入力条件で算定バッチが前提フィルタを通すものだけを返す。
 * 事業者係数の取得（getProviderFactors）は暫定適用のためフォールバック年度も含むが、
 * 対象年度が公表済みなら過年度の行は算定で採用されない。そのまま事業者・メニューの選択肢に
 * 並べると同じ事業者・同じメニューが年度違いで重複し（メニューが 1 つの事業者でもメニュー選択が
 * 出る）、過年度側を選ぶと明示指定が前提フィルタを通らず自動解決へ落ちる。
 * 「対象年度が公表済みか」は算定バッチと同じく標準係数 ∪ 事業者係数の集合で判定する。
 */
export const listApplicableProviderFactors = (
  scope: FactorResolutionScope,
  yearFactors: readonly CandidateFactorRow[],
  providerFactors: readonly CandidateFactorRow[],
): CandidateFactorRow[] =>
  filterApplicableFactors(
    [...yearFactors, ...providerFactors],
    { locationId: scope.location.id, energyType: scope.energyType, periodStart: scope.periodStart },
    toResolutionContext(scope),
  ).filter((factor) => factor.providerName !== null);

// 適用候補（先頭 = 優先順位で自動選択される係数）。算定エンジンと同じ純関数を使う。
// 事業者別係数（providerName あり）は自動候補には並ばない（明示選択専用）。
export const listEntryFactorCandidates = (
  scope: FactorResolutionScope,
  yearFactors: readonly CandidateFactorRow[],
): CandidateFactorRow[] =>
  listFactorCandidates(
    { locationId: scope.location.id, energyType: scope.energyType, periodStart: scope.periodStart },
    [...yearFactors],
    toResolutionContext(scope),
  );

// 選択中の係数。供給事業者を選択済みならその係数を最優先し、そうでなければユーザーの上書き → 候補先頭
// （自動選択）の順。上書きが候補内に無い場合（入力条件の変更後など）は自動選択へ戻す。
export const resolveSelectedFactor = (args: {
  providerFactor: CandidateFactorRow | null;
  candidates: readonly CandidateFactorRow[];
  selectedFactorId: string | null;
}): CandidateFactorRow | null =>
  args.providerFactor ??
  args.candidates.find((factor) => factor.id === args.selectedFactorId) ??
  args.candidates[0] ??
  null;

// 保存する係数 ID。編集時に係数 UI（および拠点・カテゴリ・年月）へ一度も触れていなければ、
// 元の係数指定をそのまま維持する。触れずに保存したのに供給事業者係数が代替値へ勝手に置き換わるのを防ぐ
// （事業者リストが取得できず元の係数を画面上で再現できないケースでも、意図しない上書きを防ぐ）。
export const resolveFactorIdToSave = (args: {
  isEdit: boolean;
  factorTouched: boolean;
  initialFactorId: string | null;
  selectedFactor: CandidateFactorRow | null;
}): string | null =>
  args.isEdit && !args.factorTouched ? args.initialFactorId : (args.selectedFactor?.id ?? null);

/**
 * 保存後の算定で実際に適用される係数の判定結果（プレビュー・インライン表示の唯一の基準）。
 *   pending:  判定に必要な係数（保存 id を含み得る事業者係数、選択中の供給事業者の係数）がまだ取得中
 *   unknown:  係数の取得失敗で判定できない（provider = 事業者リスト、standard = 標準係数）。
 *             保存時は factorIdToSave をそのまま送る（元の指定を維持し、算定バッチの自動解決に委ねる）
 *   resolved: resolveEmissionFactor の結果。fellBack = 保存 id が前提フィルタ不一致（archived・年度不一致・
 *             有効期間外）で指定どおりには使われない。remapped = そのうち、同一事業者・同一メニューの
 *             別年度行へ読み替えられた（事業者別係数が年度更新で入れ替わった）場合。remapped でなければ
 *             自動解決（候補先頭）に落ちる。
 *             ambiguous = 自動解決で同順位の候補が複数あり（例: A重油 / B・C重油）、算定バッチが
 *             FACTOR_AMBIGUOUS で未算定にする（factor は null。候補セレクトで選ぶと解消する）
 */
export type AppliedFactorResolution =
  | { status: 'pending' }
  | { status: 'unknown'; reason: 'provider' | 'standard' }
  | {
      status: 'resolved';
      factor: CandidateFactorRow | null;
      fellBack: boolean;
      /** fellBack のうち、同一事業者・同一メニューの当年度行へ読み替えた（自動選択ではない） */
      remapped: boolean;
      ambiguous: boolean;
      /**
       * 対象年度の公式係数が未公表で、過年度の係数を暫定適用しているか。
       * 画面に「暫定適用」と理由を出し、仮の値であることを分かるようにする。
       */
      provisional: boolean;
    };

/** 事業者係数の取得状態。'none' = 事業者係数を持たないカテゴリ（取得しない） */
export type ProviderLoadStatus = 'none' | 'loading' | 'ready' | 'error';

/**
 * 保存後の算定で実際に適用される係数を求める。resolveEmissionFactor（算定バッチと同一の純関数）に
 * 「保存する id」を明示指定として渡す。係数集合は算定バッチと同じ絞り込みをフォーム側の
 * 2 取得（標準係数 ∪ 事業者係数）で再現したもの。前提フィルタを満たさなければ自動解決（候補先頭）が
 * 返り、候補も無ければ null（未算定）。
 * resolveEmissionFactor は EmissionFactorRow を返すため、戻り値の id で pool から CandidateFactorRow を
 * 引き直す（出典表示に必要な source を保つ）。
 * 活動量の unit は渡さない（フォームの入力単位は適用係数の分母から決まる resolveEntryUnit と循環するため）。
 * フォームは常に候補の id を明示指定として保存するので、算定バッチ側の単位互換による絞り込みで
 * 結果がずれることはない。
 */
export const resolveAppliedFactor = (args: {
  scope: FactorResolutionScope;
  yearFactors: readonly CandidateFactorRow[];
  providerFactors: readonly CandidateFactorRow[];
  providerLoadStatus: ProviderLoadStatus;
  /** 事業者 UI で供給事業者が選択されている（事業者リストの取得完了までその係数が確定しない） */
  providerNameSelected: boolean;
  factorIdToSave: string | null;
}): AppliedFactorResolution => {
  const pool = [...args.yearFactors, ...args.providerFactors];
  const saveIdMissing =
    args.factorIdToSave !== null && !pool.some((factor) => factor.id === args.factorIdToSave);
  // 保存 id がローカル集合に無い（編集で開いた事業者係数など）、または供給事業者を選択済みで係数が未確定の間は
  // 事業者係数の取得完了まで判定を保留する。取得に失敗していれば「判定不能（元の指定を維持）」とする。
  if (args.providerLoadStatus === 'loading' && (saveIdMissing || args.providerNameSelected)) {
    return { status: 'pending' };
  }
  if (args.providerLoadStatus === 'error' && saveIdMissing) {
    return { status: 'unknown', reason: 'provider' };
  }
  const resolution = resolveEmissionFactorDetailed(
    {
      locationId: args.scope.location.id,
      energyType: args.scope.energyType,
      periodStart: args.scope.periodStart,
      emissionFactorId: args.factorIdToSave,
    },
    pool,
    toResolutionContext(args.scope),
  );
  const factor =
    resolution.status === 'resolved'
      ? (pool.find((candidate) => candidate.id === resolution.factor.id) ?? null)
      : null;
  return {
    status: 'resolved',
    factor,
    fellBack: args.factorIdToSave !== null && factor?.id !== args.factorIdToSave,
    remapped: resolution.status === 'resolved' && resolution.kind === 'explicit_remapped',
    ambiguous: resolution.status === 'ambiguous',
    provisional: factor !== null && isProvisionalFactor(factor, args.scope.periodStart),
  };
};
