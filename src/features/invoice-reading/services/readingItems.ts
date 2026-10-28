// 読取り（AI）・候補（コード）・係数の判定（AI）・拠点の候補（コード）の結果を、画面に出す明細にまとめる（純関数）。
// フォームに入れる値（prefill）もここで作る。活動量はフォームの単位（電気 kWh・ガス m³・燃料 L・LPG t）に換算し、
// 換算できなければ入れない（推測で単位を決めない）。

import { resolveUnitConversion } from '@/features/calculation/engine/units';
import { MANUAL_ACTIVITY_CATEGORY_MAP, type ActivityEntryPrefill } from '@/features/data-input/types';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import { NOTE_MAX_LENGTH } from '@/features/data-input/services/entrySubmission';
import type {
  InvoiceEnergyType,
  InvoiceExtractedItem,
  InvoiceExtraction,
  InvoiceFactorJudgement,
  InvoiceFuelEnergyType,
  InvoiceReadingItem,
} from '../types';
import { resolveFallbackMenu, type FactorCandidateSet } from './factorCandidates';
import type { MatchingAnswer } from './factorMatching';

/** 請求書の単位の書き方を、単位の換算（units.ts）が読める形にそろえる。読めなければそのまま返す */
export const normalizeInvoiceUnit = (unit: string): string => {
  const text = unit.normalize('NFKC').replace(/\s/g, '');
  const lower = text.toLowerCase();
  if (lower === 'kwh' || text === 'キロワットアワー' || text === 'キロワット時') return 'kWh';
  if (lower === 'mwh') return 'MWh';
  if (['m3', 'm³', '㎥', '立方メートル', '立米'].includes(lower) || text === '㎥') return 'm3';
  if (lower === '千m3' || lower === '千m³') return '千m3';
  if (['l', 'ℓ', 'リットル', 'ﾘｯﾄﾙ'].includes(lower)) return 'L';
  if (lower === 'kl' || text === 'キロリットル') return 'kL';
  if (lower === 'kg' || text === 'キログラム' || text === 'キロ') return 'kg';
  if (lower === 't' || text === 'トン') return 't';
  return text;
};

/** 活動量をフォームの単位に換算する。換算できなければ null */
export const convertToEntryUnit = (
  amount: number,
  unit: string,
  energyType: InvoiceEnergyType,
): { value: number; unit: string } | null => {
  const entryUnit = MANUAL_ACTIVITY_CATEGORY_MAP[energyType].unit;
  // 係数の単位の形（分子/分母）にして、活動量の単位からフォームの単位への倍率を得る（分子は換算に影響しない）。
  const conversion = resolveUnitConversion(normalizeInvoiceUnit(unit), `t-CO2e/${entryUnit}`);
  if (conversion === null) return null;
  // 小数の誤差（0.1 + 0.2 など）を入力欄に出さない。
  return { value: Number((amount * conversion).toFixed(6)), unit: entryUnit };
};

/** 燃料の名称から、カテゴリだけを決める（係数の判定ができなかったときの手がかり。係数は決めない） */
export const guessFuelEnergyType = (fuelName: string | null): InvoiceFuelEnergyType | null => {
  if (!fuelName) return null;
  const name = fuelName.normalize('NFKC');
  if (/ガソリン|揮発油|レギュラー|ハイオク/.test(name)) return 'fuel_gasoline';
  if (/軽油|ディーゼル/.test(name)) return 'fuel_diesel';
  if (/灯油/.test(name)) return 'fuel_kerosene';
  if (/重油/.test(name)) return 'fuel_heavy_oil';
  if (/LPG|プロパン|液化石油/i.test(name)) return 'fuel_lpg';
  return null;
};

const monthLabel = (targetMonth: string) => {
  const [year, month] = targetMonth.split('-').map(Number);
  return `${year}年${month}月分`;
};

/** 対象年月: 請求書の「◯月分」。書かれていなければ使用期間の終わりの月 */
export const targetMonthOf = (item: InvoiceExtractedItem): string | null =>
  item.usageMonth ?? (item.periodEnd ? item.periodEnd.slice(0, 7) : null);

const UNAVAILABLE_REASON = '排出係数を判定できませんでした。フォームで選んでください';

export interface ItemContext {
  index: number;
  item: InvoiceExtractedItem;
  /** 候補。対象外の明細・候補の取得をしていない明細は null */
  candidates: FactorCandidateSet | null;
  answer: MatchingAnswer | undefined;
  /** 係数の判定の AI が失敗したときの理由（全明細に共通） */
  matchingError: string | null;
}

const RESIDUAL_MENU_PATTERN = /残差/;

const judgeFactor = (
  context: ItemContext,
): {
  judgement: InvoiceFactorJudgement;
  energyType: InvoiceEnergyType | null;
  factor: ActivityEntryPrefill['factor'];
} => {
  const { item, candidates, answer } = context;
  const fallbackEnergyType: InvoiceEnergyType | null =
    item.kind === 'electricity' || item.kind === 'city_gas' ? item.kind : item.kind === 'fuel' ? guessFuelEnergyType(item.fuelName) : null;

  const isEmpty =
    !candidates || (candidates.kind === 'fuel' ? candidates.fuels.length === 0 : candidates.providers.length === 0);
  if (isEmpty) {
    return {
      judgement: { status: 'unavailable', reason: '対象年度の排出係数が見つかりませんでした' },
      energyType: fallbackEnergyType,
      factor: null,
    };
  }
  if (!answer || !answer.answered) {
    return {
      judgement: { status: 'unavailable', reason: context.matchingError ?? UNAVAILABLE_REASON },
      energyType: fallbackEnergyType,
      factor: null,
    };
  }
  if (answer.key === null) {
    return { judgement: { status: 'not_found', reason: answer.reason }, energyType: fallbackEnergyType, factor: null };
  }

  if (candidates.kind === 'fuel') {
    const fuel = candidates.fuels.find((candidate) => candidate.key === answer.key);
    if (!fuel) {
      return { judgement: { status: 'unavailable', reason: UNAVAILABLE_REASON }, energyType: fallbackEnergyType, factor: null };
    }
    return {
      judgement: { status: 'matched', label: fuel.factorName, reason: answer.reason },
      energyType: fuel.energyType,
      factor: { kind: 'standard', factorName: fuel.factorName },
    };
  }

  const provider = candidates.providers.find(
    (candidate) => candidate.key === answer.key || candidate.menus.some((menu) => menu.key === answer.key),
  );
  if (!provider) {
    return { judgement: { status: 'unavailable', reason: UNAVAILABLE_REASON }, energyType: fallbackEnergyType, factor: null };
  }
  const chosenMenu = provider.menus.find((menu) => menu.key === answer.key)?.menuName ?? null;
  // 電気で「残差」のメニューが複数ある事業者では、請求書の料金メニューからどれに当たるかは決められない。
  // AI が 1 つを選んでも採らず、人に選んでもらう。都市ガスの残差は供給区域ごとに分かれており
  // （例: 「東京ガスネットワーク株式会社の供給区域 残差」）、需要場所の住所から AI が選ぶのでここでは止めない。
  const residualMenus = provider.menus.filter((menu) => RESIDUAL_MENU_PATTERN.test(menu.menuName));
  const ambiguousResidual =
    candidates.energyType === 'electricity' &&
    chosenMenu !== null &&
    RESIDUAL_MENU_PATTERN.test(chosenMenu) &&
    residualMenus.length > 1;
  const menuName = ambiguousResidual ? null : (chosenMenu ?? resolveFallbackMenu(provider));
  // AI の判断の文は AI が選んだメニューを名前で書くため、採らなかったときは理由を判定に添える（表の判定の列に出す）
  const note = ambiguousResidual
    ? `「残差」のメニューが複数あるため（${residualMenus.map((menu) => menu.menuName).join('・')}）、AI が選んだメニューは使わず、事業者だけを入れました`
    : undefined;
  return menuName
    ? {
        judgement: { status: 'matched', label: `${provider.providerName} / ${menuName}`, reason: answer.reason },
        energyType: candidates.energyType,
        factor: { kind: 'provider', providerName: provider.providerName, menuName },
      }
    : {
        judgement: { status: 'provider_only', label: provider.providerName, reason: answer.reason, note },
        energyType: candidates.energyType,
        factor: { kind: 'provider', providerName: provider.providerName, menuName: null },
      };
};

/** 1 件の明細を、画面に出す形とフォームに入れる値にする */
export const buildReadingItem = (args: {
  extraction: InvoiceExtraction;
  context: ItemContext;
  location: { id: string; name: string } | null;
  /** 読み取った帳票。「フォームで開く」で帳票の欄へ入れ、表から登録した記録にも紐づける */
  evidence: EvidenceFile;
}): InvoiceReadingItem => {
  const { extraction, context, location, evidence } = args;
  const { item, index } = context;
  const targetMonth = targetMonthOf(item);
  const printedAmount =
    item.amount !== null ? `${item.amount.toLocaleString('ja-JP')}${item.unit ? ` ${item.unit}` : ''}` : null;
  const planOrFuelName = item.kind === 'fuel' ? item.fuelName : item.planName;

  if (item.kind === 'other') {
    return {
      index,
      energyType: null,
      title: `対象外の明細${targetMonth ? ` ${monthLabel(targetMonth)}` : ''}`,
      targetMonth,
      amount: null,
      printedAmount,
      planOrFuelName,
      factor: { status: 'unavailable', reason: '電気・都市ガス・燃料（ガソリン・軽油・灯油・重油・LPG）以外の明細は読み取りの対象外です' },
      location: null,
      notices: [],
      prefill: null,
    };
  }

  const { judgement, energyType, factor } = judgeFactor(context);
  const notices: string[] = [];
  let amount: InvoiceReadingItem['amount'] = null;
  if (energyType) {
    if (item.amount === null) {
      notices.push('使用量を読み取れませんでした。活動量を入力してください');
    } else if (!item.unit) {
      notices.push('使用量の単位を読み取れませんでした。単位を確かめて活動量を入力してください');
    } else {
      amount = convertToEntryUnit(item.amount, item.unit, energyType);
      if (!amount) {
        notices.push(
          `使用量の単位（${item.unit}）を ${MANUAL_ACTIVITY_CATEGORY_MAP[energyType].unit} に換算できません。活動量を換算して入力してください`,
        );
      }
    }
  } else {
    notices.push('燃料の種類を決められませんでした。フォームでカテゴリを選んでください');
  }
  if (!targetMonth) notices.push('使用月を読み取れませんでした。対象年月を選んでください');
  if (!location) notices.push('需要場所の住所から拠点を決められませんでした。拠点を選んでください');

  const categoryLabel = energyType ? MANUAL_ACTIVITY_CATEGORY_MAP[energyType].labelJP : '燃料';
  const note = [
    '請求書から読取り',
    extraction.supplierName,
    planOrFuelName,
    targetMonth ? monthLabel(targetMonth) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .slice(0, NOTE_MAX_LENGTH);

  return {
    index,
    energyType,
    title: `${categoryLabel} ${targetMonth ? monthLabel(targetMonth) : '（使用月不明）'}`,
    targetMonth,
    amount,
    printedAmount,
    planOrFuelName,
    factor: judgement,
    location,
    notices,
    prefill: energyType
      ? {
          locationId: location?.id ?? '',
          supplyAddress: extraction.supplyAddress,
          energyType,
          targetMonth,
          amount: amount ? String(amount.value) : '',
          note,
          factor,
          sourceLabel: `請求書「${evidence.fileName}」${extraction.items.length > 1 ? `の明細 ${index} ` : ''}から読み取った値を入れました。`,
          evidenceFiles: [evidence],
        }
      : null,
  };
};
