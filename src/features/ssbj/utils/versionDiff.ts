// SSBJ の保存版どうしの差分（保存履歴の「版を比べる」）の純関数。依存を足さずに自前で書く。
//
// - 文章は、まず文（「。」「！」「？」と改行）で区切って文の単位で対応を取り、変わった文のかたまりの中だけ文字の差分を取る。
//   長い文章でも、表の大きさが「文の数 × 文の数」と「変わったかたまりの文字数 × 文字数」で済むようにするため。
//   それでも上限を超えるかたまりは、文字の差分を取らずに「削除」と「追加」をそのまま並べる（画面を止めないため）。
// - 判断・GHG の採用値・リスク・機会などの値は、表示用の文字列にしてから「前 → 後」で比べる。
// - 保存版は書き換えないので、ここも受け取った保存版を変えない。

import {
  OGT_EMISSION_UNIT,
  SSBJ_MEASUREMENT_APPROACH_LABELS,
  SSBJ_PARENT_RELATIONSHIP_LABELS,
  SSBJ_RISK_OPPORTUNITY_KIND_LABELS,
  SSBJ_RISK_TYPE_LABELS,
  SSBJ_SCOPE2_BASIS_LABELS,
  SSBJ_TIME_HORIZON_LABELS,
  type OgtAdoptedValue,
  type OgtSupplierReference,
  type SsbjDisclosableText,
  type SsbjEvidence,
  type SsbjExternalEmissionSnapshot,
  type SsbjFieldValue,
  type SsbjJudgement,
  type SsbjNarrative,
  type SsbjReportRecord,
  type SsbjReportSnapshotV1,
  type SsbjRiskOpportunity,
  type SsbjSnapshotSections,
  type SsbjTimeHorizonDefinitions,
} from '../types';
import { formatDecimalForDisplay } from './decimal';
import { externalEmissionGasesLabel, externalEmissionLabel } from './externalEmission';
import { formatFieldValue } from './fieldValue';
import {
  SSBJ_APPLICABILITY_LABELS,
  SSBJ_MATERIALITY_LABELS,
  SSBJ_OMISSION_REASON_LABELS,
  emptySsbjJudgement,
} from './judgement';
import { EMPTY_SSBJ_DISCLOSABLE_TEXT } from './narrative';
import { OGT_DATA_QUALITY_LABELS, formatScope2BasisTotal, ogtMethodLabel, ogtValueKey, ogtValueLabel } from './ogtValue';
import { SSBJ_NARRATIVE_ITEMS, SSBJ_REQUIREMENTS, findSsbjNarrativeItem, findSsbjRequirement } from './requirementMaster';
import { formatLinkTargetWithLabel } from './riskOpportunity';

// ---------------------------------------------------------------------------
// 文章の差分
// ---------------------------------------------------------------------------

/** 文章の差分の 1 片。same = 変わらない、added = 後の版で増えた、removed = 後の版で消えた。 */
export type SsbjTextDiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

/** 文字の差分を取るかたまりの大きさの上限（前の文字数 × 後の文字数）。超えたら文字の差分を取らない。 */
export const SSBJ_CHAR_DIFF_LIMIT = 1_000_000;
/** 文の単位の対応を取る大きさの上限（前の文の数 × 後の文の数）。超えたら全体を 1 つのかたまりとして扱う。 */
const SENTENCE_DIFF_LIMIT = 250_000;

type Op = 'same' | 'removed' | 'added';

/**
 * 2 つの列の最長共通部分列から、前 → 後の操作の列を作る（同じ位置では削除を追加より先に出す）。
 * 表は (n+1)×(m+1) の整数。呼び出し元が大きさの上限を確かめてから呼ぶ。
 */
const lcsOps = <T>(before: readonly T[], after: readonly T[]): Op[] => {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push('same');
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push('removed');
      i += 1;
    } else {
      ops.push('added');
      j += 1;
    }
  }
  while (i < n) { ops.push('removed'); i += 1; }
  while (j < m) { ops.push('added'); j += 1; }
  return ops;
};

/** 隣り合う同じ種類の片をつなぎ、空の片を除く。 */
const mergeParts = (parts: SsbjTextDiffPart[]): SsbjTextDiffPart[] => {
  const merged: SsbjTextDiffPart[] = [];
  for (const part of parts) {
    if (part.text === '') continue;
    const last = merged[merged.length - 1];
    if (last && last.kind === part.kind) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
};

/** 書記素（見た目の 1 文字）に分ける道具。Intl.Segmenter が無い環境では null（コードポイントで分ける）。 */
const graphemeSegmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

/**
 * 文字（書記素）の列に分ける。ZWJ でつないだ絵文字や結合文字を途中で割らないため。
 * Intl.Segmenter が無い環境では、コードポイント（サロゲートペアは割らない）で分ける。
 */
export const splitSsbjGraphemes = (
  text: string,
  segmenter: Pick<Intl.Segmenter, 'segment'> | null = graphemeSegmenter,
): string[] => (segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text));

/** 変わったかたまりの文字の差分。前後の共通部分を先に除いてから、残りだけ表を作る。 */
const diffChars = (before: string, after: string): SsbjTextDiffPart[] => {
  const a = splitSsbjGraphemes(before);
  const b = splitSsbjGraphemes(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1;
  const head = a.slice(0, prefix).join('');
  const tail = suffix > 0 ? a.slice(a.length - suffix).join('') : '';
  const middleA = a.slice(prefix, a.length - suffix);
  const middleB = b.slice(prefix, b.length - suffix);

  const parts: SsbjTextDiffPart[] = [{ kind: 'same', text: head }];
  if (middleA.length * middleB.length > SSBJ_CHAR_DIFF_LIMIT || middleA.length === 0 || middleB.length === 0) {
    parts.push({ kind: 'removed', text: middleA.join('') }, { kind: 'added', text: middleB.join('') });
  } else {
    let i = 0;
    let j = 0;
    for (const op of lcsOps(middleA, middleB)) {
      if (op === 'same') { parts.push({ kind: 'same', text: middleA[i] }); i += 1; j += 1; }
      else if (op === 'removed') { parts.push({ kind: 'removed', text: middleA[i] }); i += 1; }
      else { parts.push({ kind: 'added', text: middleB[j] }); j += 1; }
    }
  }
  parts.push({ kind: 'same', text: tail });
  return mergeParts(parts);
};

/** 文（「。」「．」「！」「？」「!」「?」か改行で終わる単位）に区切る。区切りの文字は前の文に含める。 */
export const splitSsbjSentences = (text: string): string[] => text.match(/[^。．！？!?\n]*(?:[。．！？!?]+\n?|\n)|[^。．！？!?\n]+$/g) ?? [];

/**
 * 2 つの文章の差分。文の単位で対応を取り、変わった文のかたまりの中だけ文字の差分を取る。
 * 片をつなぐと、same と removed は前の文章に、same と added は後の文章に戻る。
 */
export const diffSsbjText = (before: string, after: string): SsbjTextDiffPart[] => {
  if (before === after) return mergeParts([{ kind: 'same', text: before }]);
  const a = splitSsbjSentences(before);
  const b = splitSsbjSentences(after);
  if (a.length * b.length > SENTENCE_DIFF_LIMIT) return diffChars(before, after);

  const parts: SsbjTextDiffPart[] = [];
  let removed = '';
  let added = '';
  const flush = () => {
    if (removed !== '' || added !== '') parts.push(...diffChars(removed, added));
    removed = '';
    added = '';
  };
  let i = 0;
  let j = 0;
  for (const op of lcsOps(a, b)) {
    if (op === 'same') {
      flush();
      parts.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (op === 'removed') {
      removed += a[i];
      i += 1;
    } else {
      added += b[j];
      j += 1;
    }
  }
  flush();
  return mergeParts(parts);
};

// ---------------------------------------------------------------------------
// 保存版の差分
// ---------------------------------------------------------------------------

/** 項目の中の 1 つの欄の変化。文章は文字の差分、それ以外は「前 → 後」。 */
export type SsbjVersionFieldChange =
  | { kind: 'text'; label: string; parts: SsbjTextDiffPart[] }
  | { kind: 'value'; label: string; before: string; after: string };

/** 変わった項目 1 つ。added / removed は、片方の版にしか無い項目（リスク・機会、根拠文書など ID で区別するもの）。 */
export type SsbjVersionChange = {
  /** 画面の中で「見た」を覚えるための一意のキー。 */
  key: string;
  /** まとまりの名前（例「四本柱の文章」）。 */
  group: string;
  /** 項目の名前（要求項目マスターの名前など）。 */
  title: string;
  /** 小さく添える ID（項目 ID・要求 ID）。無ければ null。 */
  id: string | null;
  status: 'added' | 'removed' | 'changed';
  fields: SsbjVersionFieldChange[];
};

export type SsbjVersionDiff = {
  changes: SsbjVersionChange[];
  /** 片方の版にセクションが無く、比べなかったもの（項目を足す前の保存版など）。まとまりの名前。 */
  uncompared: string[];
};

/** 片方の版に項目が無いときの表示。 */
const ABSENT = '（なし）';
/** 値が無い（null・キーの欠落）ときの表示。保存版はキーの欠落を未入力と同じく扱う（docs/ssbj-spec.md §8）。 */
const UNANSWERED = '未入力';

type FieldSpec<T> = {
  label: string;
  /** 表示用の文字列。 */
  show: (item: T) => string;
  /** 文字の差分を取る元の文章。入力済みの文章のときだけ返し、それ以外は null（表示用の文字列で比べる）。 */
  text?: (item: T) => string | null;
};

const orUnanswered = (value: string | null | undefined): string => (value == null || value === '' ? UNANSWERED : value);
const answeredText = (field: SsbjFieldValue<string> | undefined): string | null =>
  field?.state === 'answered' ? field.value : null;
const showField = (field: SsbjFieldValue<string> | undefined): string => (field ? formatFieldValue(field) : UNANSWERED);

/** 開示する文章と内部メモの 2 つの欄。内部メモを除いた保存版（キーが無い）どうしでは、内部メモの欄は変化にならない。 */
const disclosableFields = <T>(
  disclosureLabel: string,
  internalLabel: string,
  get: (item: T) => SsbjDisclosableText | undefined,
): FieldSpec<T>[] => [
  { label: disclosureLabel, show: item => showField(get(item)?.disclosure), text: item => answeredText(get(item)?.disclosure) },
  { label: internalLabel, show: item => orUnanswered(get(item)?.internalNote), text: item => get(item)?.internalNote ?? null },
];

const compareFields = <T>(specs: FieldSpec<T>[], before: T | undefined, after: T | undefined): SsbjVersionFieldChange[] =>
  specs.flatMap((spec): SsbjVersionFieldChange[] => {
    const shownBefore = before === undefined ? ABSENT : spec.show(before);
    const shownAfter = after === undefined ? ABSENT : spec.show(after);
    const textBefore = before !== undefined && spec.text ? spec.text(before) : null;
    const textAfter = after !== undefined && spec.text ? spec.text(after) : null;
    if (textBefore !== null && textAfter !== null) {
      return textBefore === textAfter ? [] : [{ kind: 'text', label: spec.label, parts: diffSsbjText(textBefore, textAfter) }];
    }
    if (shownBefore === shownAfter) return [];
    // 片方の版に項目が無く、もう片方も未入力の欄は並べない（増えた・消えた項目の入力済みの欄だけを見せる）。
    if ((before === undefined && shownAfter === UNANSWERED) || (after === undefined && shownBefore === UNANSWERED)) return [];
    return [{ kind: 'value', label: spec.label, before: shownBefore, after: shownAfter }];
  });

type Keyed<T> = {
  group: string;
  /** 項目のキー（同じ項目かどうかの判定に使う）。 */
  keyOf: (item: T) => string;
  titleOf: (item: T) => string;
  idOf?: (item: T) => string | null;
  /** 片方の版に無い項目の代わり。指定すれば added / removed にせず、既定の値（未入力など）と比べる。 */
  emptyOf?: (key: string) => T;
  /** 並べる順。指定が無ければ後の版の順、消えた項目は前の版の順で後ろに足す。 */
  orderOf?: (key: string) => number;
  fields: FieldSpec<T>[];
};

const compareLists = <T>(spec: Keyed<T>, before: readonly T[], after: readonly T[]): SsbjVersionChange[] => {
  const beforeByKey = new Map(before.map(item => [spec.keyOf(item), item]));
  const afterByKey = new Map(after.map(item => [spec.keyOf(item), item]));
  const keys = [...new Set([...after.map(spec.keyOf), ...before.map(spec.keyOf)])];
  if (spec.orderOf) {
    const orderOf = spec.orderOf;
    const position = new Map(keys.map((key, index) => [key, index]));
    keys.sort((x, y) => orderOf(x) - orderOf(y) || (position.get(x) ?? 0) - (position.get(y) ?? 0));
  }
  return keys.flatMap((key): SsbjVersionChange[] => {
    let previous = beforeByKey.get(key);
    let next = afterByKey.get(key);
    let status: SsbjVersionChange['status'] = 'changed';
    if (spec.emptyOf) {
      previous ??= spec.emptyOf(key);
      next ??= spec.emptyOf(key);
    } else if (previous === undefined) {
      status = 'added';
    } else if (next === undefined) {
      status = 'removed';
    }
    const fields = compareFields(spec.fields, previous, next);
    if (fields.length === 0 && status === 'changed') return [];
    const shown = (next ?? previous) as T;
    return [{
      key: `${spec.group}:${key}`,
      group: spec.group,
      title: spec.titleOf(shown),
      id: spec.idOf?.(shown) ?? null,
      status,
      fields,
    }];
  });
};

const indexOrLast = (index: number): number => (index < 0 ? Number.MAX_SAFE_INTEGER : index);

const REPORT_FIELDS: FieldSpec<SsbjReportRecord>[] = [
  { label: 'レポート名', show: report => orUnanswered(report.title), text: report => report.title || null },
  { label: '対象年度', show: report => `${report.fiscalYearLabel}（${report.periodStart} 〜 ${report.periodEnd}）` },
  { label: '作成目的', show: report => orUnanswered(report.purpose), text: report => report.purpose ?? null },
  { label: '報告範囲', show: report => orUnanswered(report.reportingScope), text: report => report.reportingScope ?? null },
  { label: '参照する基準の版', show: report => orUnanswered(report.standardVersion) },
  { label: '親会社名', show: report => orUnanswered(report.parentCompanyName) },
  {
    label: '親会社との関係',
    show: report => orUnanswered(report.parentRelationship ? SSBJ_PARENT_RELATIONSHIP_LABELS[report.parentRelationship] : null),
  },
  { label: '親会社の持分比率', show: report => orUnanswered(report.ownershipPercentage ? `${report.ownershipPercentage}%` : null) },
  {
    label: '測定アプローチ',
    show: report => orUnanswered(report.measurementApproach ? SSBJ_MEASUREMENT_APPROACH_LABELS[report.measurementApproach] : null),
  },
  { label: '業種（SICS）', show: report => orUnanswered(report.industryCode) },
];

const NARRATIVES: Keyed<SsbjNarrative> = {
  group: 'ガバナンス・戦略等の文章',
  keyOf: narrative => narrative.itemId,
  titleOf: narrative => findSsbjNarrativeItem(narrative.itemId)?.label ?? narrative.itemId,
  idOf: narrative => narrative.itemId,
  emptyOf: key => ({ itemId: key as SsbjNarrative['itemId'], text: EMPTY_SSBJ_DISCLOSABLE_TEXT }),
  orderOf: key => indexOrLast(SSBJ_NARRATIVE_ITEMS.findIndex(item => item.id === key)),
  fields: disclosableFields('開示する文章', '内部メモ（開示しない）', narrative => narrative.text),
};

const RISKS: Keyed<SsbjRiskOpportunity> = {
  group: 'リスク・機会',
  keyOf: item => item.id,
  titleOf: item => item.title,
  fields: [
    { label: '区分', show: item => SSBJ_RISK_OPPORTUNITY_KIND_LABELS[item.kind] },
    { label: '名称', show: item => item.title, text: item => item.title },
    { label: 'リスクの種類', show: item => (item.riskType ? formatFieldValue(item.riskType, value => SSBJ_RISK_TYPE_LABELS[value]) : UNANSWERED) },
    ...disclosableFields<SsbjRiskOpportunity>('説明', '内部メモ（開示しない）', item => item.description),
    { label: '時間軸', show: item => formatFieldValue(item.timeHorizon, value => SSBJ_TIME_HORIZON_LABELS[value]) },
    { label: '関連する章・項目', show: item => orUnanswered(item.linkTargets.map(formatLinkTargetWithLabel).join('、')) },
  ],
};

const TIME_HORIZON_FIELDS: FieldSpec<SsbjTimeHorizonDefinitions>[] = [
  { label: '短期', show: item => showField(item.shortTerm), text: item => answeredText(item.shortTerm) },
  { label: '中期', show: item => showField(item.mediumTerm), text: item => answeredText(item.mediumTerm) },
  { label: '長期', show: item => showField(item.longTerm), text: item => answeredText(item.longTerm) },
  {
    label: '戦略上の計画期間との関係',
    show: item => showField(item.planningHorizonRelation),
    text: item => answeredText(item.planningHorizonRelation),
  },
  { label: '内部メモ（開示しない）', show: item => orUnanswered(item.internalNote), text: item => item.internalNote ?? null },
];

const JUDGEMENTS: Keyed<SsbjJudgement> = {
  group: '該当性・重要性の判断',
  keyOf: judgement => judgement.requirementId,
  titleOf: judgement => findSsbjRequirement(judgement.requirementId)?.summary ?? judgement.requirementId,
  idOf: judgement => judgement.requirementId,
  emptyOf: key => emptySsbjJudgement(key as SsbjJudgement['requirementId']),
  orderOf: key => indexOrLast(SSBJ_REQUIREMENTS.findIndex(requirement => requirement.id === key)),
  fields: [
    { label: '該当性', show: judgement => SSBJ_APPLICABILITY_LABELS[judgement.applicability] },
    { label: '重要性', show: judgement => SSBJ_MATERIALITY_LABELS[judgement.materiality] },
    { label: '記載しない理由', show: judgement => SSBJ_OMISSION_REASON_LABELS[judgement.omissionReason] },
    ...disclosableFields<SsbjJudgement>('開示する説明', '内部の検討理由（開示しない）', judgement => judgement.explanation),
  ],
};

const emission = (value: string): string => `${formatDecimalForDisplay(value)} ${OGT_EMISSION_UNIT}`;

const GHG_VALUES: Keyed<OgtAdoptedValue> = {
  group: 'GHG排出量（OGT の採用値）',
  keyOf: ogtValueKey,
  titleOf: ogtValueLabel,
  fields: [
    { label: '採用値', show: value => formatFieldValue(value.value, emission) },
    {
      label: 'ロケーション基準',
      show: value => (value.scope === 2 && value.method.basisTotals ? formatScope2BasisTotal(value.method.basisTotals.locationBased) : ABSENT),
    },
    {
      label: 'マーケット基準',
      show: value => (value.scope === 2 && value.method.basisTotals ? formatScope2BasisTotal(value.method.basisTotals.marketBased) : ABSENT),
    },
    { label: '算定状態', show: value => OGT_DATA_QUALITY_LABELS[value.dataQuality] },
    { label: '採用方式', show: ogtMethodLabel },
    { label: '対象期間', show: value => `${value.period.startDate} 〜 ${value.period.endDate}` },
  ],
};

const SUPPLIERS: Keyed<OgtSupplierReference> = {
  group: 'サプライヤー別排出量（参考値）',
  keyOf: item => `${item.scope3CategoryId}:${item.supplierId}`,
  titleOf: item => `${item.supplierName}（カテゴリ ${item.scope3CategoryId}）`,
  fields: [{ label: '排出量', show: item => emission(item.emissions) }],
};

const EXTERNAL_EMISSIONS: Keyed<SsbjExternalEmissionSnapshot> = {
  group: '外部で算定した排出量',
  keyOf: item => item.id,
  titleOf: externalEmissionLabel,
  fields: [
    { label: '区分', show: externalEmissionLabel },
    { label: 'Scope 2 の基準', show: item => (item.scope2Basis ? SSBJ_SCOPE2_BASIS_LABELS[item.scope2Basis] : ABSENT) },
    { label: '対象ガス', show: item => externalEmissionGasesLabel(item.gases ?? []) },
    { label: '排出量', show: item => emission(item.value) },
    { label: '対象期間', show: item => `${item.period.startDate} 〜 ${item.period.endDate}` },
    { label: '算定した者', show: item => orUnanswered(item.calculatedBy) },
    { label: '算定方法', show: item => orUnanswered(item.calculationMethod), text: item => item.calculationMethod ?? null },
    { label: '根拠文書', show: item => orUnanswered(item.evidenceTitle) },
    { label: '確認者', show: item => orUnanswered(item.confirmedByName) },
    { label: '内部メモ（開示しない）', show: item => orUnanswered(item.internalNote), text: item => item.internalNote ?? null },
  ],
};

const EVIDENCE: Keyed<SsbjEvidence> = {
  group: '根拠文書',
  keyOf: item => item.id,
  titleOf: item => findSsbjNarrativeItem(item.itemId)?.label ?? item.itemId,
  idOf: item => item.itemId,
  fields: [
    { label: '開示用参照文', show: item => showField(item.disclosure), text: item => answeredText(item.disclosure) },
    { label: '資料名（内部記録）', show: item => orUnanswered(item.documentTitle) },
    { label: '資料の版（内部記録）', show: item => orUnanswered(item.documentVersion) },
    { label: '保管先（内部記録）', show: item => orUnanswered(item.internalLocation) },
    { label: '参照位置（内部記録）', show: item => orUnanswered(item.referencePosition) },
    { label: '主管部署（内部記録）', show: item => orUnanswered(item.ownerDepartment) },
    { label: 'ファイル名（内部記録）', show: item => orUnanswered(item.fileName) },
    { label: 'ファイルの SHA-256（内部記録）', show: item => orUnanswered(item.fileSha256) },
  ],
};

const SECTION_GROUPS: Record<keyof SsbjSnapshotSections, string> = {
  narratives: NARRATIVES.group,
  risks_opportunities: RISKS.group,
  time_horizons: '時間軸の定義',
  judgements: JUDGEMENTS.group,
  ghg: GHG_VALUES.group,
  external_emissions: EXTERNAL_EMISSIONS.group,
  evidence: EVIDENCE.group,
};

/**
 * 2 つの保存版の、変わった項目だけを並べる（基本情報 → 文章 → リスク・機会 → 時間軸 → 判断 → GHG → 外部算定値 → 根拠文書）。
 * 内部メモ・内部記録を比べたくないときは、呼び出し元が両方を utils/disclosedSnapshot.ts で除いてから渡す
 * （キーの無い欄は変化にならない）。
 */
export const diffSsbjSnapshots = (before: SsbjReportSnapshotV1, after: SsbjReportSnapshotV1): SsbjVersionDiff => {
  const changes: SsbjVersionChange[] = [];
  const uncompared: string[] = [];
  const a = before.sections;
  const b = after.sections;
  /** 両方の版にあるセクションだけ比べる。片方にしか無ければ比べなかったものとして名前を返す。 */
  const both = <K extends keyof SsbjSnapshotSections>(key: K): [SsbjSnapshotSections[K], SsbjSnapshotSections[K]] | null => {
    const x = a[key];
    const y = b[key];
    if (x === undefined && y === undefined) return null;
    if (x === undefined || y === undefined) {
      uncompared.push(SECTION_GROUPS[key]);
      return null;
    }
    return [x as SsbjSnapshotSections[K], y as SsbjSnapshotSections[K]];
  };

  const reportFields = compareFields(REPORT_FIELDS, before.report, after.report);
  if (reportFields.length > 0) {
    changes.push({ key: '基本情報', group: '基本情報', title: '基本情報', id: null, status: 'changed', fields: reportFields });
  }

  const narratives = both('narratives');
  if (narratives) changes.push(...compareLists(NARRATIVES, narratives[0], narratives[1]));

  const risks = both('risks_opportunities');
  if (risks) changes.push(...compareLists(RISKS, risks[0], risks[1]));

  const horizons = both('time_horizons');
  if (horizons) {
    const fields = compareFields(TIME_HORIZON_FIELDS, horizons[0], horizons[1]);
    if (fields.length > 0) {
      changes.push({ key: '時間軸の定義', group: '時間軸の定義', title: '時間軸の定義', id: null, status: 'changed', fields });
    }
  }

  const judgements = both('judgements');
  if (judgements) changes.push(...compareLists(JUDGEMENTS, judgements[0], judgements[1]));

  // GHG は、OGT の値を採用していない版では null（未採用）。未採用と採用済みの違いは、区分ごとに増えた・消えたとして出す。
  const ghg = both('ghg');
  if (ghg) {
    changes.push(...compareLists(GHG_VALUES, ghg[0]?.values ?? [], ghg[1]?.values ?? []));
    changes.push(...compareLists(SUPPLIERS, ghg[0]?.supplierReferences ?? [], ghg[1]?.supplierReferences ?? []));
  }

  const external = both('external_emissions');
  if (external) changes.push(...compareLists(EXTERNAL_EMISSIONS, external[0], external[1]));

  const evidence = both('evidence');
  if (evidence) changes.push(...compareLists(EVIDENCE, evidence[0], evidence[1]));

  return { changes, uncompared };
};

// ---------------------------------------------------------------------------
// 既定で比べる 2 つの版
// ---------------------------------------------------------------------------

type VersionPoint = { id: string; versionNumber: number; createdAt: string };

/**
 * 既定で比べる 2 つの版。後は最新の版。前は、最新のレビュー依頼より前に保存した最後の版（request）。
 * 依頼の時点が分からない・依頼より前の版が無い・依頼の後に保存した版が無い（前が最新の版になる）ときは、1 つ前の版（previous）。
 * 版が 2 つ未満なら null。
 */
export const defaultSsbjCompareVersions = (
  versions: readonly VersionPoint[],
  latestRequestAt: string | null,
): { fromId: string; toId: string; basis: 'request' | 'previous' } | null => {
  if (versions.length < 2) return null;
  const sorted = [...versions].sort((x, y) => y.versionNumber - x.versionNumber);
  const latest = sorted[0];
  if (latestRequestAt) {
    const requestTime = Date.parse(latestRequestAt);
    const beforeRequest = sorted.find(version => Date.parse(version.createdAt) <= requestTime);
    if (beforeRequest && beforeRequest.id !== latest.id) {
      return { fromId: beforeRequest.id, toId: latest.id, basis: 'request' };
    }
  }
  return { fromId: sorted[1].id, toId: latest.id, basis: 'previous' };
};

/**
 * 選んだ 2 つの版を、版番号の小さい順（前 → 後）に並べる。「前の版」に新しい版を選んでも、逆向きの差分にしないため。
 * 入れ替えたときは swapped = true（画面で入れ替えた旨を出す）。どちらかの版が一覧に無ければ、選んだ順のまま。
 */
export const orderSsbjCompareVersions = (
  versions: readonly Pick<VersionPoint, 'id' | 'versionNumber'>[],
  fromId: string,
  toId: string,
): { fromId: string; toId: string; swapped: boolean } => {
  const numberOf = (id: string) => versions.find(version => version.id === id)?.versionNumber;
  const fromNumber = numberOf(fromId);
  const toNumber = numberOf(toId);
  if (fromNumber !== undefined && toNumber !== undefined && fromNumber > toNumber) {
    return { fromId: toId, toId: fromId, swapped: true };
  }
  return { fromId, toId, swapped: false };
};
