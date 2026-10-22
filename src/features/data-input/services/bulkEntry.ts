// 複数月まとめて入力（一括入力）の月リスト組立・既存レコード照合・検証・保存内容の組み立て
// （純関数・副作用なし）。
// グリッドの行は「会計年度の各月 × 既存レコードの有無 × 未来月ガード」で決まり、
// 既存レコードがある月は値を表示してスキップ（既定）か上書きを選べるようにする。
// 重複判定キーは事前警告・保存時ブロック（activityRecordDuplicates / DB トリガー）と同じ
// 「拠点 × エネルギー種別 × 対象月」（Scope3積上げはさらにカテゴリ × IDEA製品）で、照合も同じ純関数を使う。

import type { EnergyType } from '@/features/calculation/types';
import type { IdeaProductDetail } from '@/features/factors/services/ideaProductSearch';
import type { ActivityEntryInput, SavedManualActivityRecord } from '../types';
import {
  findDuplicateActivityRecord,
  type ActivityEntryDuplicateCandidate,
} from './activityRecordDuplicates';
import type { BulkMonthFactor } from './bulkFactorResolution';
import {
  ZERO_AMOUNT_PREVIEW_NOTICE,
  buildActivityEntryInput,
  validateAmount,
  amountValidationMessage,
} from './entrySubmission';
import type { EntryCategory } from './entryCategory';
import { factorNameWithValue, formatEmissions } from './entryFormat';
import {
  applicableYearForDate,
  computeEstimatedEmissions,
  type FiscalYearRange,
} from './inlineCalculation';
import { toPeriodDates } from './manualEntryTargetMonth';
import { computeEstimatedScope3Emissions } from './scope3InlineCalculation';
import { toYearMonthLabel } from './targetMonthSelection';

/**
 * 一括入力の対象（既存レコードの照合キーのうち対象月を除いた部分）。月ごとに periodStart を足して、
 * 事前警告・保存時ブロックと同じ重複キー（ActivityEntryDuplicateCandidate）として照合する。
 * scope12 は「拠点 × エネルギー種別 × 対象月」、scope3 は「拠点 × カテゴリ × IDEA製品 × 対象月」。
 */
export type BulkEntryTarget =
  | { kind: 'scope12'; locationId: string; energyType: EnergyType }
  | { kind: 'scope3'; locationId: string; scope3CategoryId: number; ideaFactorId: string };

const toDuplicateCandidate = (target: BulkEntryTarget, month: string): ActivityEntryDuplicateCandidate => ({
  ...target,
  periodStart: `${month}-01`,
});

export interface BulkMonthRow {
  /** 'YYYY-MM' */
  month: string;
  /** 「2026年4月」 */
  label: string;
  /** 未来月（入力不可） */
  isFuture: boolean;
  /** 同じ重複キーの登録済みレコード。取込データ（CSV 等）も保存時ブロックの対象なので区別しない */
  existing: SavedManualActivityRecord | null;
  /**
   * 既存レコードを上書きできるか。単位が現在の入力単位と異なるレコード（MWh などの取込データ）は、
   * グリッドの単位のまま上書きすると意味が変わるため不可（入力履歴の編集へ誘導する）。
   */
  canOverwrite: boolean;
}

export const buildBulkMonthRows = (args: {
  months: string[];
  history: SavedManualActivityRecord[];
  /** null = 照合キーが未確定（IDEA 製品の未選択など）。既存レコードの照合は行わない */
  target: BulkEntryTarget | null;
  /** 当月（これより後は未来月として入力不可） */
  maxTargetMonth: string;
  /** 現在の入力単位（未確定なら null → 上書き不可） */
  currentUnit: string | null;
}): BulkMonthRow[] => {
  const target = args.target;
  return args.months.map((month) => {
    const existing =
      target === null ? null : findDuplicateActivityRecord(args.history, toDuplicateCandidate(target, month));
    const isFuture = month > args.maxTargetMonth;
    return {
      month,
      label: toYearMonthLabel(month),
      isFuture,
      existing,
      canOverwrite:
        existing !== null && !isFuture && args.currentUnit !== null && existing.unit === args.currentUnit,
    };
  });
};

/** 検証を通過した 1 ヶ月分の入力。保存内容の組み立て（buildBulkSaveItems）に渡す。 */
export interface BulkCollectedEntry {
  month: string;
  label: string;
  amount: number;
  action: 'create' | 'overwrite';
  /** action='overwrite' のときの上書き対象 */
  existing: SavedManualActivityRecord | null;
}

export const BULK_VALIDATION_MESSAGES = {
  noEntries: '登録する月の活動量を入力してください。',
  overwriteEmpty: '上書きする活動量を入力してください。',
  /** 入力できる月（当月以前）を含む会計年度が無い（未登録、または登録済みの年度が全月未来） */
  noFiscalYear:
    '入力できる月を含む会計年度が登録されていないため、複数月まとめて入力は使用できません。設定画面で会計年度を登録してください。',
} as const;

/**
 * グリッドの入力値を検証して保存対象の月を集める。最初のエラーを「月ラベル: 文言」で返す。
 *   - 未来月・既存あり（上書き未選択）の行は入力値が残っていても対象にしない
 *   - 上書きを選択した行は入力必須
 *   - 空欄の行はスキップ（その月は登録しない）
 *   - 活動量の検証は単月入力と同じ validateAmount（0 は実績ゼロとして有効、負数・桁あふれは不可）
 */
export const collectBulkEntries = (args: {
  rows: BulkMonthRow[];
  amounts: Record<string, string>;
  overwriteEnabled: Record<string, boolean>;
}): { entries: BulkCollectedEntry[]; error: string | null } => {
  const entries: BulkCollectedEntry[] = [];
  for (const row of args.rows) {
    const overwriting = row.existing !== null && row.canOverwrite && args.overwriteEnabled[row.month] === true;
    if (row.isFuture || (row.existing !== null && !overwriting)) {
      continue;
    }
    const raw = (args.amounts[row.month] ?? '').trim();
    if (raw === '') {
      if (overwriting) {
        return { entries: [], error: `${row.label}: ${BULK_VALIDATION_MESSAGES.overwriteEmpty}` };
      }
      continue;
    }
    const validation = validateAmount(raw);
    if (validation.kind !== 'valid') {
      return { entries: [], error: `${row.label}: ${amountValidationMessage(validation)}` };
    }
    entries.push({
      month: row.month,
      label: row.label,
      amount: validation.value,
      action: overwriting ? 'overwrite' : 'create',
      existing: overwriting ? row.existing : null,
    });
  }
  if (entries.length === 0) {
    return { entries: [], error: BULK_VALIDATION_MESSAGES.noEntries };
  }
  return { entries, error: null };
};

/** 一括保存の 1 件分。overwrite は既存レコードの更新（recordId 必須）。 */
export type BulkSaveItem =
  | { action: 'create'; month: string; label: string; entry: ActivityEntryInput }
  | { action: 'overwrite'; month: string; label: string; recordId: string; entry: ActivityEntryInput };

/**
 * 検証済みの月ごとの入力から保存内容を組み立てる。組み立てられない月があれば null（呼び出し側で
 * 汎用の不整合エラーにする）。
 *   - 係数は月ごとの解決結果（factorIdByMonth）を使う。会計年度内でも温対法年度の境界をまたぐと
 *     適用できる係数の行が変わるため、単一の係数 ID を全月へ使い回さない
 *   - 備考は新規登録の月のみに保存し、上書きする月は既存の備考を保持する（一括入力の備考で
 *     既存の月別メモを黙って消さない）
 */
export const buildBulkSaveItems = (args: {
  category: EntryCategory;
  locationId: string;
  entries: BulkCollectedEntry[];
  unit: string;
  note: string;
  factorIdByMonth: ReadonlyMap<string, string | null>;
  ideaFactorId: string | null;
}): BulkSaveItem[] | null => {
  const items: BulkSaveItem[] = [];
  for (const collected of args.entries) {
    const period = toPeriodDates(collected.month);
    if (period === null) {
      return null;
    }
    const entry = buildActivityEntryInput({
      category: args.category,
      locationId: args.locationId,
      period,
      amount: collected.amount,
      unit: args.unit,
      note: collected.action === 'overwrite' ? (collected.existing?.note ?? '') : args.note,
      emissionFactorId: args.factorIdByMonth.get(collected.month) ?? null,
      ideaFactorId: args.ideaFactorId,
    });
    if (entry === null) {
      return null;
    }
    if (collected.action === 'overwrite') {
      if (collected.existing === null) {
        return null;
      }
      items.push({
        action: 'overwrite',
        month: collected.month,
        label: collected.label,
        recordId: collected.existing.id,
        entry,
      });
    } else {
      items.push({ action: 'create', month: collected.month, label: collected.label, entry });
    }
  }
  return items;
};

/** 一括入力の確認モーダルに出す月ごとの行。 */
export interface BulkPreviewMonthRow {
  month: string;
  label: string;
  actionLabel: '新規登録' | '上書き';
  /** '10,000 kWh' */
  amountText: string;
  /** 算定で適用される係数（名称と値）。未算定見込みなら null */
  factorText: string | null;
  /** 推定排出量（t-CO2e）。計算できない月は '—' */
  emissionsText: string;
  /** この月だけの注意（代替値へのフォールバック・候補なし・単位換算不可など） */
  warning: string | null;
}

export interface BulkPreview {
  monthRows: BulkPreviewMonthRow[];
  /** '12.345 t-CO2e'。計算できない月が 1 つでもあれば '—' */
  totalEmissionsText: string;
  createCount: number;
  overwriteCount: number;
}

const BULK_MONTH_WARNINGS = {
  ambiguous: '同順位の候補が複数あるため未算定になります。単月入力で係数を選択してください。',
  noFactor: '適用できる係数が無いため未算定になります。',
  fellBack: '選択中の係数はこの月には適用できないため、自動選択された係数で算定されます。',
  providerFellBack:
    '選択中の供給事業者の係数はこの月の年度には登録されていないため、代替値（自動選択された係数）で算定されます。',
  provisional: '対象年度の公式係数が未公表のため、過年度の係数を暫定適用します。',
  unitMismatch: '活動量の単位を係数の単位へ換算できないため未算定になります。',
  unresolved: '適用される係数を判定できませんでした。算定時に自動解決します。',
} as const;

const resolveMonthEmissions = (args: {
  entry: BulkCollectedEntry;
  unit: string;
  isIdea: boolean;
  monthFactor: BulkMonthFactor | undefined;
  productDetail: IdeaProductDetail | null;
  fiscalYears: FiscalYearRange[];
}): { emissions: number | null; factorText: string | null; warning: string | null } => {
  if (args.isIdea) {
    if (args.productDetail === null) {
      return { emissions: null, factorText: null, warning: BULK_MONTH_WARNINGS.unresolved };
    }
    const applicableYear = applicableYearForDate(args.fiscalYears, `${args.entry.month}-01`);
    return {
      emissions: computeEstimatedScope3Emissions(args.entry.amount, args.productDetail, applicableYear),
      factorText: args.productDetail.productName,
      warning: null,
    };
  }
  const applied = args.monthFactor?.applied;
  if (applied === undefined || applied.status !== 'resolved') {
    return { emissions: null, factorText: null, warning: BULK_MONTH_WARNINGS.unresolved };
  }
  if (applied.factor === null) {
    return {
      emissions: null,
      factorText: null,
      warning: applied.ambiguous ? BULK_MONTH_WARNINGS.ambiguous : BULK_MONTH_WARNINGS.noFactor,
    };
  }
  const emissions = computeEstimatedEmissions(args.entry.amount, args.unit, applied.factor);
  const warning = args.monthFactor?.providerFellBack
    ? BULK_MONTH_WARNINGS.providerFellBack
    : applied.fellBack
      ? BULK_MONTH_WARNINGS.fellBack
      : applied.provisional
        ? BULK_MONTH_WARNINGS.provisional
        : emissions === null
          ? BULK_MONTH_WARNINGS.unitMismatch
          : null;
  return { emissions, factorText: factorNameWithValue(applied.factor), warning };
};

/**
 * 確認モーダルの表示内容を組み立てる。推定排出量は単月入力と同じ計算
 * （算定エンジンと同じ単位換算・丸め）を月ごとの適用係数で行う。
 * 活動量 0 の月は単月入力のプレビューと同じ確認表示を行に添える（係数の注意がある月はそちらを優先）。
 */
export const buildBulkPreview = (args: {
  entries: BulkCollectedEntry[];
  unit: string;
  isIdea: boolean;
  /** Scope1/2 の月ごとの係数解決結果（IDEA では null）。 */
  factorByMonth: ReadonlyMap<string, BulkMonthFactor> | null;
  productDetail: IdeaProductDetail | null;
  fiscalYears: FiscalYearRange[];
}): BulkPreview => {
  let total = 0;
  let totalKnown = true;
  const monthRows = args.entries.map((entry): BulkPreviewMonthRow => {
    const { emissions, factorText, warning } = resolveMonthEmissions({
      entry,
      unit: args.unit,
      isIdea: args.isIdea,
      monthFactor: args.factorByMonth?.get(entry.month),
      productDetail: args.productDetail,
      fiscalYears: args.fiscalYears,
    });
    if (emissions === null) {
      totalKnown = false;
    } else {
      total += emissions;
    }
    return {
      month: entry.month,
      label: entry.label,
      actionLabel: entry.action === 'overwrite' ? '上書き' : '新規登録',
      amountText: `${entry.amount.toLocaleString()} ${args.unit}`,
      factorText,
      emissionsText: emissions === null ? '—' : formatEmissions(emissions),
      warning: warning ?? (entry.amount === 0 ? ZERO_AMOUNT_PREVIEW_NOTICE : null),
    };
  });
  return {
    monthRows,
    totalEmissionsText: totalKnown ? `${formatEmissions(total)} t-CO2e` : '—',
    createCount: args.entries.filter((entry) => entry.action === 'create').length,
    overwriteCount: args.entries.filter((entry) => entry.action === 'overwrite').length,
  };
};
