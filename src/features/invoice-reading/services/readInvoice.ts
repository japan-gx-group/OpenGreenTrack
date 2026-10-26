// 請求書の AI 読取り（サーバ専用）。POST /api/ai/invoice-reading から呼ぶ。
//
// 処理の順番:
//   1. 読取り（用途 invoice_reading。PDF・画像を共通の入口に渡す）
//   2. 候補の絞り込み（コード）。明細の使用月から温対法の年度を出し、その年度の係数（未公表なら暫定適用の過年度）を
//      ログイン中の人のセッションで読む（RLS で自組織と公式係数だけ）。電気・都市ガスは事業者別係数、燃料は主要燃料の標準係数
//   3. 係数の判定（用途 invoice_factor_matching。読み取った文字と候補だけを送る。失敗しても読取りの結果は返す）
//   4. 拠点の候補（コード。需要場所の住所と拠点の住所を突き合わせる。拠点の一覧は AI に送らない）
// ファイル・読み取った値・AI の出力は保存しない（監査ログには共通の入口が用途・モデル・結果だけを残す）。
// 呼び出し側（Route Handler）がログイン済みであることを確かめ、getCurrentProfile() の結果を渡すこと。

import 'server-only';
import { generateStructured } from '@/lib/ai/generate';
import { detectFileMimeType } from '@/lib/ai/inputCheck';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { createClient } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/supabaseRows';
import type { CurrentProfile } from '@/lib/currentProfile';
import type { AiGenerateErrorCode } from '@/types/ai';
import {
  deriveApplicableYear,
  filterApplicableFactors,
  withProvisionalYears,
} from '@/features/calculation/engine/resolveEmissionFactor';
import type { EmissionFactorRow, EnergyType } from '@/features/calculation/types';
import { getCurrentYearMonth } from '@/features/data-input/services/manualEntryTargetMonth';
import {
  INVOICE_FUEL_ENERGY_TYPES,
  type InvoiceExtractedItem,
  type InvoiceExtraction,
  type InvoiceReadingResult,
} from '../types';
import {
  buildFuelCandidates,
  buildProviderCandidates,
  type CandidateSourceRow,
  type FactorCandidateSet,
} from './factorCandidates';
import {
  FACTOR_MATCHING_INSTRUCTIONS,
  FACTOR_MATCHING_SCHEMA,
  buildMatchingInput,
  validateFactorMatching,
  type MatchingAnswer,
  type MatchingTarget,
} from './factorMatching';
import {
  INVOICE_EXTRACTION_INSTRUCTIONS,
  INVOICE_EXTRACTION_SCHEMA,
  validateInvoiceExtraction,
} from './invoiceExtraction';
import { matchLocationByAddress, type LocationAddressOption } from './locationMatching';
import { buildReadingItem, targetMonthOf } from './readingItems';

export type ReadInvoiceResult =
  | { ok: true; result: InvoiceReadingResult }
  | { ok: false; code: AiGenerateErrorCode | 'load_failed'; message: string; retryAfterSeconds?: number };

const FACTOR_SELECT =
  'id,organizationId,name,energyType,scope,factorValue,unit,applicableYear,regionName,status,isCustom,locationId,supplierId,effectiveFrom,effectiveTo,providerName,providerNumber,menuName,factorType';

type FactorRow = EmissionFactorRow & { name: string };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const LOAD_FAILED_MESSAGE = '排出係数・拠点の読み込みに失敗しました。時間をおいて再度お試しください';

/** 係数を読む（自組織のカスタム係数と公式係数。RLS で絞られる）。numeric は文字列で返ることがあるため数値にする */
const loadFactors = async (
  supabase: ServerClient,
  filter: { energyTypes: readonly string[]; years: number[]; provider: boolean; providerNumber?: string },
): Promise<FactorRow[]> => {
  const rows = await fetchAllRows<FactorRow>((from, to) => {
    let query = supabase
      .from('emission_factors')
      .select(FACTOR_SELECT)
      .eq('status', 'active')
      .in('energyType', [...filter.energyTypes])
      .in('applicableYear', filter.years);
    query = filter.provider ? query.not('providerName', 'is', null) : query.is('providerName', null);
    if (filter.providerNumber) query = query.eq('providerNumber', filter.providerNumber);
    return query.order('id', { ascending: true }).range(from, to);
  }, '排出係数の取得に失敗しました');
  return rows.map((row) => ({ ...row, factorValue: Number(row.factorValue) }));
};

const toCandidateSource = (row: FactorRow): CandidateSourceRow => ({
  name: row.name,
  energyType: row.energyType,
  unit: row.unit,
  factorValue: row.factorValue,
  providerName: row.providerName,
  providerNumber: row.providerNumber,
  menuName: row.menuName,
});

/**
 * 明細の候補を組み立てる。年度は明細の使用月（読めなければ今月）の温対法の年度。
 * 算定バッチ・入力フォームと同じ filterApplicableFactors で、対象年度が未公表なら過年度の係数を暫定適用する。
 */
const buildCandidates = async (
  supabase: ServerClient,
  extraction: InvoiceExtraction,
  item: InvoiceExtractedItem,
  locationId: string | null,
  cache: Map<string, Promise<FactorRow[]>>,
): Promise<FactorCandidateSet | null> => {
  if (item.kind === 'other') return null;
  const periodStart = `${targetMonthOf(item) ?? getCurrentYearMonth()}-01`;
  const year = deriveApplicableYear(periodStart);
  const years = withProvisionalYears([year]);
  const applicable = (rows: FactorRow[], energyType: EnergyType) =>
    filterApplicableFactors(rows, { locationId: locationId ?? '', energyType, periodStart }, {
      applicableYear: year,
      regionName: null,
    });
  const cached = (key: string, load: () => Promise<FactorRow[]>) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const pending = load();
    cache.set(key, pending);
    return pending;
  };

  if (item.kind === 'fuel') {
    const rows = await cached(`fuel:${year}`, () =>
      loadFactors(supabase, { energyTypes: INVOICE_FUEL_ENERGY_TYPES, years, provider: false }),
    );
    return buildFuelCandidates(INVOICE_FUEL_ENERGY_TYPES.flatMap((energyType) => applicable(rows, energyType)).map(toCandidateSource));
  }

  const energyType = item.kind;
  const number = extraction.supplierRegistrationNumber;
  // 登録番号が分かれば、その事業者の行だけを読む（電気は全事業者で 1 年度約 2,400 行あるため）。
  // 番号の行が無ければ（番号の読み違い・登録番号の変更）、全事業者を読んで名前で絞る。
  let rows = number
    ? await cached(`${energyType}:${year}:${number}`, () =>
        loadFactors(supabase, { energyTypes: [energyType], years, provider: true, providerNumber: number }),
      )
    : [];
  if (rows.length === 0) {
    rows = await cached(`${energyType}:${year}`, () =>
      loadFactors(supabase, { energyTypes: [energyType], years, provider: true }),
    );
  }
  return buildProviderCandidates({
    energyType,
    rows: applicable(rows, energyType).map(toCandidateSource),
    registrationNumber: number,
    supplierName: extraction.supplierName,
  });
};

export const readInvoice = async (args: {
  profile: Pick<CurrentProfile, 'id' | 'organizationId'>;
  file: Uint8Array;
  fileName: string;
  signal?: AbortSignal;
}): Promise<ReadInvoiceResult> => {
  const log = await getRequestLogger();
  const mimeType = detectFileMimeType(args.file);
  const read = await generateStructured({
    purpose: 'invoice_reading',
    profile: args.profile,
    instructions: INVOICE_EXTRACTION_INSTRUCTIONS,
    // 形式の確認（PDF か画像か）は共通の入口でも先頭のバイトで行う。ここでは送る種類を決めるだけ。
    input: [mimeType === 'application/pdf' ? { type: 'pdf', data: args.file } : { type: 'image', data: args.file }],
    schema: INVOICE_EXTRACTION_SCHEMA,
    validate: validateInvoiceExtraction,
    signal: args.signal,
  });
  if (!read.ok) {
    return { ok: false, code: read.code, message: read.message, retryAfterSeconds: read.retryAfterSeconds };
  }
  const extraction = read.value;

  const supabase = await createClient();
  let location: { id: string; name: string } | null = null;
  const candidatesByIndex = new Map<number, FactorCandidateSet | null>();
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, address')
      .in('status', ['active', 'paused']);
    if (error) throw new Error('拠点の取得に失敗しました');
    location = matchLocationByAddress(extraction.supplyAddress, (data ?? []) as LocationAddressOption[]);
    const cache = new Map<string, Promise<FactorRow[]>>();
    await Promise.all(
      extraction.items.map(async (item, position) => {
        candidatesByIndex.set(
          position + 1,
          await buildCandidates(supabase, extraction, item, location?.id ?? null, cache),
        );
      }),
    );
  } catch (error) {
    log.error({ error }, '請求書の読取りで、排出係数・拠点の読み込みに失敗しました');
    return { ok: false, code: 'load_failed', message: LOAD_FAILED_MESSAGE };
  }

  const targets: MatchingTarget[] = extraction.items.flatMap((item, position) => {
    const candidates = candidatesByIndex.get(position + 1);
    const hasCandidates =
      candidates && (candidates.kind === 'fuel' ? candidates.fuels.length > 0 : candidates.providers.length > 0);
    return hasCandidates ? [{ index: position + 1, item, candidates }] : [];
  });

  let answers = new Map<number, MatchingAnswer>();
  let matchingError: string | null = null;
  if (targets.length > 0) {
    const matched = await generateStructured({
      purpose: 'invoice_factor_matching',
      profile: args.profile,
      instructions: FACTOR_MATCHING_INSTRUCTIONS,
      input: [{ type: 'text', text: buildMatchingInput(extraction, targets) }],
      schema: FACTOR_MATCHING_SCHEMA,
      validate: validateFactorMatching(targets),
      signal: args.signal,
    });
    if (matched.ok) {
      answers = matched.value;
    } else {
      // 判定に失敗しても、読み取った使用量はフォームに入れられるので結果は返す（係数は人が選ぶ）。
      matchingError = `排出係数を判定できませんでした（${matched.message}）。フォームで選んでください`;
    }
  }

  return {
    ok: true,
    result: {
      supplierName: extraction.supplierName,
      supplyAddress: extraction.supplyAddress,
      warnings: extraction.warnings,
      provider: read.provider,
      modelId: read.modelId,
      items: extraction.items.map((item, position) =>
        buildReadingItem({
          extraction,
          context: {
            index: position + 1,
            item,
            candidates: candidatesByIndex.get(position + 1) ?? null,
            answer: answers.get(position + 1),
            matchingError,
          },
          location,
          fileName: args.fileName,
        }),
      ),
    },
  };
};
