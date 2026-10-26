// 一括登録の表の行（純関数・副作用なし）。読み取りの結果から行を作り、利用者が直した値を重ね、
// 登録できるか（必須項目・重複・係数）を確かめて、保存する内容とフォームに入れる値を組み立てる。
// 1 行 = 1 明細。1 枚の請求書に燃料が 3 種類あれば 3 行になる。

import type { EnergyType } from '@/features/calculation/types';
import {
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ActivityEntryInput,
  type ActivityEntryPrefill,
  type ManualEntryLocationOption,
  type SavedManualActivityRecord,
} from '@/features/data-input/types';
import { findDuplicateActivityRecord } from '@/features/data-input/services/activityRecordDuplicates';
import { amountValidationMessage, validateAmount } from '@/features/data-input/services/entrySubmission';
import { computeEstimatedEmissions } from '@/features/data-input/services/inlineCalculation';
import { toPeriodDates, validateTargetMonth } from '@/features/data-input/services/manualEntryTargetMonth';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import type { InvoiceEnergyType, InvoiceReadingItem, InvoiceReadingResult } from '../types';
import type { RowFactorChoice, RowFactorView } from './rowFactorResolution';

/** 表の行の元（読み取りの結果のまま） */
export interface ReviewRowSource {
  key: string;
  evidence: EvidenceFile;
  item: InvoiceReadingItem;
  energyType: InvoiceEnergyType;
}

/** 利用者が表で直せる値 */
export interface ReviewRowValues extends RowFactorChoice {
  locationId: string;
  /** 'YYYY-MM'。読めなければ '' */
  targetMonth: string;
  amount: string;
}

/** 読み取りの結果から、表に並べる行を作る（フォームに入れられない明細は除く） */
export const buildReviewRowSources = (results: readonly InvoiceReadingResult[]): ReviewRowSource[] =>
  results.flatMap((result) =>
    result.items.flatMap((item) =>
      item.prefill && item.energyType
        ? [{ key: `${result.evidence.id}:${item.index}`, evidence: result.evidence, item, energyType: item.energyType }]
        : [],
    ),
  );

/** フォームに入れられない明細（対象外・燃料の種類が分からない）。表の下に理由と一緒に並べる */
export const listUnregistrableItems = (results: readonly InvoiceReadingResult[]) =>
  results.flatMap((result) =>
    result.items.filter((item) => !item.prefill || !item.energyType).map((item) => ({ evidence: result.evidence, item })),
  );

/** 行の最初の値（読み取りの結果） */
export const initialRowValues = (source: ReviewRowSource): ReviewRowValues => {
  const prefill = source.item.prefill!;
  return {
    locationId: prefill.locationId,
    targetMonth: prefill.targetMonth ?? '',
    amount: prefill.amount,
    providerName: prefill.factor?.kind === 'provider' ? prefill.factor.providerName : null,
    menuName: prefill.factor?.kind === 'provider' ? prefill.factor.menuName : null,
    factorName: prefill.factor?.kind === 'standard' ? prefill.factor.factorName : null,
    selectedFactorId: null,
  };
};

export interface ReviewRowCheck {
  /** 登録できない理由（直すまで登録できない） */
  errors: string[];
  /** 確かめてほしいこと（登録はできるが、既定ではチェックを入れない） */
  warnings: string[];
  /** 推定排出量（t-CO2e）。係数・活動量が決まらなければ null */
  emissions: number | null;
}

const unitOf = (energyType: EnergyType) => MANUAL_ACTIVITY_CATEGORY_MAP[energyType].unit;

/**
 * 行を確かめる。errors があれば登録できない（必須項目・同じ条件の記録が登録済み・表の中で同じ条件が重なる）。
 * 同じ拠点・カテゴリ・対象年月の記録は DB の二重計上防止のトリガーで保存できないため、警告ではなく errors にする。
 * warnings は登録できるが確かめてほしいこと（メニューが決まっていない・係数が複数で決まらない など）。
 * otherRows は表の中の、この行より前にある「登録する」行（表の中での重複を見つけるため）。
 */
export const checkReviewRow = (args: {
  source: ReviewRowSource;
  values: ReviewRowValues;
  view: RowFactorView | null;
  locations: readonly ManualEntryLocationOption[];
  historyRecords: readonly SavedManualActivityRecord[];
  otherRows: ReadonlyArray<{ source: ReviewRowSource; values: ReviewRowValues }>;
  maxTargetMonth: string;
}): ReviewRowCheck => {
  const { source, values, view } = args;
  const errors: string[] = [];
  const warnings: string[] = [];

  const location = args.locations.find((candidate) => candidate.id === values.locationId);
  if (!location) errors.push('拠点を選んでください');
  const month = validateTargetMonth(values.targetMonth, args.maxTargetMonth);
  if (month.error) errors.push(month.error);
  const amount = validateAmount(values.amount);
  const amountMessage = amountValidationMessage(amount);
  if (amountMessage) errors.push(amountMessage);

  if (location && month.period) {
    const candidate = { kind: 'scope12' as const, locationId: location.id, energyType: source.energyType, periodStart: month.period.start };
    if (findDuplicateActivityRecord(args.historyRecords, candidate)) {
      errors.push('同じ拠点・カテゴリ・対象年月の記録が登録済みです（合算するなら、入力履歴から既存の記録を開いて直してください）');
    }
    const duplicatedInTable = args.otherRows.some(
      (other) =>
        other.values.locationId === location.id &&
        other.values.targetMonth === values.targetMonth &&
        other.source.energyType === source.energyType,
    );
    if (duplicatedInTable) errors.push('表の中で、先に登録する明細と拠点・カテゴリ・対象年月が同じです（合算して 1 件にしてください）');
  }

  if (view === null) {
    if (location && month.period) warnings.push('排出係数を確認しています');
  } else {
    if (view.isProvider && values.providerName && !view.providerFactor) {
      warnings.push(
        view.menuOptions.length === 0
          ? 'この年度の、選んだ事業者の係数が見つかりません。代替値で算定されます'
          : 'メニューを選んでください（選ばないと代替値で算定されます）',
      );
    }
    if (view.applied.status === 'resolved' && view.applied.ambiguous) {
      warnings.push('当てはまる排出係数が複数あります。候補から選んでください');
    }
    if (view.applied.status === 'resolved' && view.applied.factor === null) {
      warnings.push('この条件に適用できる排出係数が見つかりません。保存すると未算定になります');
    }
  }

  const emissions =
    amount.kind === 'valid' && view?.applied.status === 'resolved' && view.applied.factor
      ? computeEstimatedEmissions(amount.value, unitOf(source.energyType), view.applied.factor)
      : null;

  return { errors, warnings, emissions };
};

/** 登録する内容（保存の経路は Scope1/2。係数は表で決まった ID を明示して保存する） */
export const buildRowEntry = (args: {
  source: ReviewRowSource;
  values: ReviewRowValues;
  view: RowFactorView | null;
}): ActivityEntryInput | null => {
  const period = toPeriodDates(args.values.targetMonth);
  const amount = validateAmount(args.values.amount);
  if (!period || amount.kind !== 'valid' || !args.values.locationId) return null;
  return {
    kind: 'scope12',
    input: {
      locationId: args.values.locationId,
      energyType: args.source.energyType,
      amount: amount.value,
      unit: unitOf(args.source.energyType),
      periodStart: period.start,
      periodEnd: period.end,
      note: args.source.item.prefill?.note || null,
      emissionFactorId: args.view?.factorIdToSave ?? null,
    },
  };
};

/** 「フォームで開く」で入れる値（表で直した値を反映する） */
export const buildRowPrefill = (args: {
  source: ReviewRowSource;
  values: ReviewRowValues;
  view: RowFactorView | null;
}): ActivityEntryPrefill => {
  const prefill = args.source.item.prefill!;
  const standardName = args.view?.selectedFactor && !args.view.providerFactor ? args.view.selectedFactor.name : args.values.factorName;
  return {
    ...prefill,
    locationId: args.values.locationId,
    targetMonth: args.values.targetMonth || null,
    amount: args.values.amount,
    factor: args.values.providerName
      ? { kind: 'provider', providerName: args.values.providerName, menuName: args.values.menuName }
      : standardName && !args.view?.isProvider
        ? { kind: 'standard', factorName: standardName }
        : null,
  };
};
