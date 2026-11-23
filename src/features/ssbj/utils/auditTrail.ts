// 証跡一式（R2-33。docs/ssbj-spec.md §13「証跡一式の出力（R2-33）」）の純関数:
// DB 関数 ssbj_audit_trail_details の結果の検証、保存版の開示値と明細から計算し直した合計の照合、Excel の各シートの行。
//
// 開示値は保存版に固定した値（sections.ghg）。明細は出力した時点の OGT のデータで、保存版を作った後に OGT で算定し直すと
// 合計が開示値と一致しなくなる。そのときは照合の列で「不一致」と知らせ、黙って合わせない。

import {
  ENERGY_LABEL_BY_VALUE,
  FACTOR_TYPE_LABEL_BY_VALUE,
  SOURCE_LABEL_BY_VALUE,
  STATUS_LABEL_BY_VALUE,
} from '@/features/factors/services/factorService';
import { SCOPE3_CATEGORY_NAMES } from '@/features/scope-analysis/services/scopeAnalysisService';
import {
  OGT_EMISSION_UNIT,
  type SsbjAuditLog,
  type SsbjAuditTrailDetails,
  type SsbjDecimalString,
  type SsbjFieldValue,
  type SsbjGhgAdoption,
  type SsbjReportSnapshotV1,
  type SsbjTrailDetail,
} from '../types';
import { ssbjAuditExportRows } from './auditLog';
import { isDecimalString } from './decimal';
import { isSsbjItemId } from './ids';
import { findSsbjNarrativeItem } from './requirementMaster';

// ---------------------------------------------------------------------------
// 結果の検証
// ---------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const assertDecimal = (value: unknown, what: string): void => {
  if (!isDecimalString(value)) throw new Error(`証跡の${what}の形式が正しくありません`);
};
const assertNullableDecimal = (value: unknown, what: string): void => {
  if (value !== null && value !== undefined) assertDecimal(value, what);
};

/**
 * ssbj_audit_trail_details の結果を確かめる。数値が十進文字列でなければ例外にする（0 や NaN にして出力しない）。
 * 年度が見えない（null）ときも例外にする。
 */
export const toSsbjAuditTrailDetails = (raw: unknown): SsbjAuditTrailDetails => {
  if (!isObject(raw) || !Array.isArray(raw.details) || !Array.isArray(raw.scope3Direct) || !Array.isArray(raw.factors)) {
    throw new Error('証跡の明細を取得できませんでした');
  }
  for (const detail of raw.details as unknown[]) {
    if (!isObject(detail) || !Array.isArray(detail.basis) || !Array.isArray(detail.evidenceFiles)) {
      throw new Error('証跡の明細の形式が正しくありません');
    }
    assertDecimal(detail.emissions, '排出量');
    assertDecimal(detail.amount, '活動量');
    assertNullableDecimal(detail.appliedFactorValue, '係数');
    for (const basis of detail.basis as unknown[]) {
      if (!isObject(basis)) throw new Error('証跡の明細の形式が正しくありません');
      assertDecimal(basis.emissions, '基準別の排出量');
      assertNullableDecimal(basis.appliedFactorValue, '係数');
    }
  }
  for (const row of raw.scope3Direct as unknown[]) {
    if (!isObject(row)) throw new Error('証跡の明細の形式が正しくありません');
    assertDecimal(row.emissions, '直接入力の排出量');
  }
  for (const factor of raw.factors as unknown[]) {
    if (!isObject(factor)) throw new Error('証跡の係数の形式が正しくありません');
    assertDecimal(factor.factorValue, '係数');
  }
  return raw as unknown as SsbjAuditTrailDetails;
};

// ---------------------------------------------------------------------------
// 照合
// ---------------------------------------------------------------------------

/** 十進文字列 → 小数部の桁数をそろえた BigInt（例 "12.5", 3 → 12500n）。 */
const toScaled = (value: string, scale: number): bigint => {
  const negative = value.startsWith('-');
  const [integer, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const scaled = BigInt(integer + fraction.padEnd(scale, '0').slice(0, scale));
  return negative ? -scaled : scaled;
};

const fromScaled = (value: bigint, scale: number): string => {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integer = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${integer}${scale > 0 ? `.${fraction}` : ''}`;
};

const scaleOf = (value: string): number => value.split('.')[1]?.length ?? 0;

/**
 * 十進文字列の合計（丸めない）。number に変換すると桁落ちするため BigInt で足す（docs/ssbj-spec.md §6）。
 * 空なら "0"。
 */
export const sumDecimalStrings = (values: readonly string[]): string => {
  const scale = Math.max(0, ...values.map(scaleOf));
  return fromScaled(values.reduce((sum, value) => sum + toScaled(value, scale), BigInt(0)), scale);
};

/**
 * 小数第 places 位に丸める（四捨五入。負の数は 0 から遠い方へ。PostgreSQL の numeric の丸めと同じ）。
 * OGT の集計（dashboard_aggregates の numeric(15,3)）と同じ丸めで、明細の合計を開示値と比べるために使う。
 */
export const roundDecimalString = (value: string, places: number): string => {
  const scale = scaleOf(value);
  if (scale <= places) return fromScaled(toScaled(value, places), places);
  const scaled = toScaled(value, scale);
  const divisor = BigInt(10) ** BigInt(scale - places);
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const rounded = (abs + divisor / BigInt(2)) / divisor;
  return fromScaled(negative ? -rounded : rounded, places);
};

/** 十進文字列の正規化（先頭・末尾の余分な 0 と、-0 をそろえる）。値の比較にだけ使う。 */
const normalizeDecimal = (value: string): string => {
  const negative = value.startsWith('-');
  const [integer, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const int = integer.replace(/^0+(?=\d)/, '');
  const frac = fraction.replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : int;
  return negative && body !== '0' ? `-${body}` : body;
};

/** 十進文字列どうしが同じ値か（"812.340" と "812.34" は同じ）。 */
export const decimalStringsEqual = (a: string, b: string): boolean => normalizeDecimal(a) === normalizeDecimal(b);

export type TrailReconcileStatus = 'match' | 'mismatch' | 'not_calculated';

export const TRAIL_RECONCILE_LABELS: Record<TrailReconcileStatus, string> = {
  match: '一致',
  mismatch: '不一致',
  not_calculated: '照合しない（開示値が未算定）',
};

/** 開示値 1 つの照合の結果。 */
export type TrailReconcileRow = {
  /** 明細の「開示値の区分」と同じ識別子（scope1 / scope2 / scope2.location_based / scope3 / scope3.category1 …）。 */
  key: string;
  label: string;
  disclosed: SsbjFieldValue<SsbjDecimalString>;
  /** 出力する明細の行の合計。Scope 2 の基準別で、基準別の明細が無い活動量があれば null（OGT も基準別を未算定にする）。 */
  recomputed: SsbjDecimalString | null;
  status: TrailReconcileStatus;
  /** その開示値に入る明細の件数（活動量・直接入力の行）。 */
  detailCount: number;
};

const SCOPE2_BASIS_KEYS = { locationBased: 'scope2.location_based', marketBased: 'scope2.market_based' } as const;
const SCOPE2_BASIS_LABELS = { locationBased: 'Scope 2（ロケーション基準）', marketBased: 'Scope 2（マーケット基準）' } as const;
const SCOPE2_BASIS_VALUES = { locationBased: 'location_based', marketBased: 'market_based' } as const;

const categoryKey = (categoryId: number) => `scope3.category${categoryId}`;
const categoryLabel = (categoryId: number) => `カテゴリ ${categoryId}：${SCOPE3_CATEGORY_NAMES[categoryId] ?? ''}`;

/** 明細の行が入る開示値の区分。 */
export const trailDetailKey = (detail: Pick<SsbjTrailDetail, 'scope' | 'categoryId'>): string =>
  detail.scope === 'scope3' && detail.categoryId !== null ? categoryKey(detail.categoryId) : detail.scope;

const reconcile = (
  key: string,
  label: string,
  disclosed: SsbjFieldValue<SsbjDecimalString>,
  recomputed: SsbjDecimalString | null,
  detailCount: number,
): TrailReconcileRow => ({
  key,
  label,
  disclosed,
  recomputed,
  detailCount,
  status: disclosed.state !== 'answered'
    ? 'not_calculated'
    : recomputed !== null && decimalStringsEqual(disclosed.value, recomputed) ? 'match' : 'mismatch',
});

/** 明細の排出量を、開示値の区分ごとにまとめる（Scope 3 のカテゴリには直接入力の値も入れる）。 */
const emissionsByKey = (trail: SsbjAuditTrailDetails): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  const add = (key: string, value: string) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const detail of trail.details) add(trailDetailKey(detail), detail.emissions);
  for (const row of trail.scope3Direct) add(categoryKey(row.categoryId), row.emissions);
  return map;
};

/**
 * 保存版の開示値（sections.ghg）と、出力する明細の行の合計を突き合わせる。OGT の値を採用していない版は空。
 * 合計の作り方は OGT の集計と同じ: Scope 1・2・3 の合計と Scope 2 の基準別は小数第 3 位に丸め、Scope 3 のカテゴリは丸めない。
 * Scope 3 のカテゴリで明細が無いものは 0 として比べる（OGT は排出量が 0 のカテゴリを集計に出さないため）。
 */
export const reconcileTrail = (ghg: SsbjGhgAdoption | null | undefined, trail: SsbjAuditTrailDetails): TrailReconcileRow[] => {
  if (!ghg) return [];
  const byKey = emissionsByKey(trail);
  const scope3Keys = [...byKey.keys()].filter(key => key.startsWith('scope3'));
  const scope2Details = trail.details.filter(detail => detail.scope === 'scope2');
  const totalOf = (key: string) => roundDecimalString(sumDecimalStrings(byKey.get(key) ?? []), 3);
  const countOf = (key: string) => byKey.get(key)?.length ?? 0;
  const rows: TrailReconcileRow[] = [];

  for (const value of ghg.values) {
    if (value.scope3CategoryId !== null) {
      const key = categoryKey(value.scope3CategoryId);
      rows.push(reconcile(key, categoryLabel(value.scope3CategoryId), value.value, sumDecimalStrings(byKey.get(key) ?? []), countOf(key)));
      continue;
    }
    if (value.scope === 3) {
      const all = scope3Keys.flatMap(key => byKey.get(key) ?? []);
      rows.push(reconcile('scope3', 'Scope 3', value.value, roundDecimalString(sumDecimalStrings(all), 3), all.length));
      continue;
    }
    const key = `scope${value.scope}`;
    rows.push(reconcile(key, `Scope ${value.scope}`, value.value, totalOf(key), countOf(key)));
    if (value.scope === 2 && value.method.basisTotals) {
      for (const basis of ['locationBased', 'marketBased'] as const) {
        const parts = scope2Details.map(detail => detail.basis.find(item => item.basis === SCOPE2_BASIS_VALUES[basis])?.emissions ?? null);
        const complete = parts.every((part): part is string => part !== null);
        rows.push(reconcile(
          SCOPE2_BASIS_KEYS[basis],
          SCOPE2_BASIS_LABELS[basis],
          value.method.basisTotals[basis],
          complete ? roundDecimalString(sumDecimalStrings(parts as string[]), 3) : null,
          scope2Details.length,
        ));
      }
    }
  }
  return rows;
};

// ---------------------------------------------------------------------------
// シートの行
// ---------------------------------------------------------------------------

export type TrailExportContext = {
  version: { id: string; versionNumber: number; snapshot: SsbjReportSnapshotV1 };
  /** 承認した版か（承認していない版は社内確認用）。 */
  isApprovedVersion: boolean;
  generatedAt: string;
  generatedBy: string;
  /** 内部メモ・内部記録（根拠文書の資料名・保管先・ファイルの記録、活動量のメモなど）を含めるか。既定は含めない。 */
  internalRecords: boolean;
};

const label = <T extends string>(labels: Partial<Record<T, string>>, value: string | null): string =>
  value === null ? '' : labels[value as T] ?? value;

const fieldText = (value: SsbjFieldValue<SsbjDecimalString>): string => (value.state === 'answered' ? value.value : '未算定');

export const TRAIL_SUMMARY_HEADER = ['開示値の区分', '対象ID', '開示値（保存版）', '明細から計算した値（出力時点）', '単位', '照合', '明細の件数'];

/** サマリのシート。照合の見出しの行の位置も返す（Excel の見出しの書式に使う）。 */
export const trailSummaryRows = (
  context: TrailExportContext,
  reconcileRows: readonly TrailReconcileRow[],
): { rows: string[][]; headerRowIndex: number } => {
  const { snapshot } = context.version;
  const ghg = snapshot.sections.ghg;
  const mismatches = reconcileRows.filter(row => row.status === 'mismatch').length;
  const rows: string[][] = [
    ['SSBJレポート 証跡一式（社内確認用・保証の対応用）'],
    ['レポート名', snapshot.report.title],
    ['年度・期間', `${snapshot.report.fiscalYearLabel}（${snapshot.report.periodStart} 〜 ${snapshot.report.periodEnd}）`],
    ['保存版', `版 ${context.version.versionNumber}（${context.isApprovedVersion ? '承認した版' : '承認していない版'}）`, context.version.id],
    ['出力日時', context.generatedAt],
    ['出力した人', context.generatedBy],
    ['内部メモ・内部記録', context.internalRecords ? '含める' : '含めない'],
    ['照合の結果', ghg ? (mismatches === 0 ? 'すべて一致' : `${mismatches} 件が一致しない`) : 'OGT の値を採用していないため照合しない'],
    ['明細の時点', '明細・係数・帳票は出力した時点の OGT のデータ。開示値は保存版に固定した値'],
    [],
  ];
  const headerRowIndex = rows.length;
  rows.push(TRAIL_SUMMARY_HEADER);
  for (const row of reconcileRows) {
    rows.push([
      row.label, row.key, fieldText(row.disclosed), row.recomputed ?? '基準別の明細が揃っていない', OGT_EMISSION_UNIT,
      TRAIL_RECONCILE_LABELS[row.status], String(row.detailCount),
    ]);
  }
  if (!ghg) rows.push(['OGT の値を採用していない版です。照合する開示値がありません。']);

  const externals = snapshot.sections.external_emissions ?? [];
  if (externals.length > 0) {
    rows.push([], ['外部算定値（OGT の明細は無い。根拠文書でたどる）']);
    rows.push(['外部算定値ID', 'Scope', 'カテゴリ・基準', '対象ガス', '排出量', '単位', ...(context.internalRecords ? ['根拠文書', '算定した者', '算定方法', '確認者'] : [])]);
    for (const item of externals) {
      rows.push([
        item.id, `Scope ${item.scope}`,
        item.scope3CategoryId !== null ? categoryLabel(item.scope3CategoryId)
          : item.scope2Basis ? (item.scope2Basis === 'location' ? 'ロケーション基準' : 'マーケット基準') : '',
        item.gases.join('・'), item.value, item.unit,
        ...(context.internalRecords ? [item.evidenceTitle ?? '', item.calculatedBy, item.calculationMethod, item.confirmedByName ?? ''] : []),
      ]);
    }
  }

  rows.push(
    [],
    ['読み方'],
    ['・「明細」の「開示値の区分」で、どの開示値に入る活動量かを示す。Scope 3 は、方式が積上げのカテゴリは活動量、直接入力のカテゴリは直接入力の値が入る'],
    ['・Scope 1・2・3 の合計は、明細の排出量の合計を小数第 3 位に丸めたもの（OGT の集計と同じ）。カテゴリ別の値は丸めない'],
    ['・「係数」は明細で使った係数の現在の内容。明細の「係数値（適用時）」は算定した時点の値で、係数の版が変わっていれば違うことがある'],
    ['・「不一致」は、保存版を作った後に OGT で算定し直した・活動量を変えたことを示す。開示値（保存版）は変わっていない'],
  );
  return { rows, headerRowIndex };
};

export const trailDetailHeader = (internalRecords: boolean): string[] => [
  '開示値の区分', '対象ID', '活動量ID', '拠点', '入力元', 'エネルギー種別', '期間（開始）', '期間（終了）', '活動量', '単位',
  '係数名（適用時）', '係数値（適用時）', '係数の単位', '係数ID', '排出量（t-CO2e）',
  'ロケーション基準（t-CO2e）', 'マーケット基準（t-CO2e）', 'マーケット基準の係数', '帳票', '算定日時',
  ...(internalRecords ? ['メモ（内部）'] : []),
];

const detailLabel = (key: string): string => {
  if (key === 'scope1') return 'Scope 1';
  if (key === 'scope2') return 'Scope 2';
  if (key === 'scope3') return 'Scope 3';
  const category = Number(key.replace('scope3.category', ''));
  return categoryLabel(category);
};

const SCOPE2_EVIDENCE_LABELS: Record<string, string> = {
  grid_average: '全国の代替値',
  contract_menu: '契約したメニューの係数',
  grid_fallback: '代替値で補った分',
};

/** 明細のシートの行（見出しの行を含む）。活動量の行の後に、Scope 3 の直接入力の行を出す。 */
export const trailDetailRows = (trail: SsbjAuditTrailDetails, internalRecords: boolean): string[][] => {
  const rows: string[][] = [trailDetailHeader(internalRecords)];
  for (const detail of trail.details) {
    const key = trailDetailKey(detail);
    const location = detail.basis.find(basis => basis.basis === 'location_based');
    const market = detail.basis.find(basis => basis.basis === 'market_based');
    rows.push([
      detailLabel(key), key, detail.activityRecordId, detail.locationName ?? '', detail.sourceType,
      label(ENERGY_LABEL_BY_VALUE, detail.energyType), detail.periodStart, detail.periodEnd, detail.amount, detail.unit,
      detail.appliedFactorName ?? '', detail.appliedFactorValue ?? '', detail.appliedFactorUnit ?? '', detail.emissionFactorId ?? '',
      detail.emissions, location?.emissions ?? '', market?.emissions ?? '',
      market ? `${market.appliedFactorName ?? ''}（${SCOPE2_EVIDENCE_LABELS[market.evidence] ?? market.evidence}）` : '',
      detail.evidenceFiles.map(file => file.fileName).join('、'), detail.calculatedAt,
      ...(internalRecords ? [detail.note ?? ''] : []),
    ]);
  }
  for (const row of trail.scope3Direct) {
    const key = categoryKey(row.categoryId);
    rows.push([
      detailLabel(key), key, row.id, '', '直接入力', '', row.periodStart ?? '', row.periodEnd ?? '', '', '',
      '', '', '', '', row.emissions, '', '', '', '', row.updatedAt,
      ...(internalRecords ? [row.dataSourceNote ?? ''] : []),
    ]);
  }
  return rows;
};

export const TRAIL_FACTOR_HEADER = [
  '係数ID', '名称', 'Scope', 'エネルギー種別', '係数値（現在）', '単位', '適用年度', '地域', '出典', '出典資料', '出典の URL',
  '供給事業者', 'メニュー', '温対法の区分', '状態', '自社設定', '有効期間（開始）', '有効期間（終了）', '明細の件数',
];

/** 係数のシートの行（見出しの行を含む）。 */
export const trailFactorRows = (trail: SsbjAuditTrailDetails): string[][] => {
  const usage = new Map<string, number>();
  for (const detail of trail.details) {
    for (const id of new Set([detail.emissionFactorId, ...detail.basis.map(basis => basis.emissionFactorId)])) {
      if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
    }
  }
  return [
    TRAIL_FACTOR_HEADER,
    ...trail.factors.map(factor => [
      factor.id, factor.name, factor.scope.replace('scope', 'Scope '), label(ENERGY_LABEL_BY_VALUE, factor.energyType),
      factor.factorValue, factor.unit, String(factor.applicableYear), factor.regionName, label(SOURCE_LABEL_BY_VALUE, factor.source),
      factor.sourceDocumentName ?? '', factor.sourceUrl ?? '', factor.providerName ?? '', factor.menuName ?? '',
      label(FACTOR_TYPE_LABEL_BY_VALUE, factor.factorType), label(STATUS_LABEL_BY_VALUE, factor.status), factor.isCustom ? 'はい' : 'いいえ',
      factor.effectiveFrom ?? '', factor.effectiveTo ?? '', String(usage.get(factor.id) ?? 0),
    ]),
  ];
};

/** 根拠のシートの行。SSBJ の根拠文書（保存版）と、活動量に紐づく帳票（出力時点の OGT）。見出しの行の位置も返す。 */
export const trailEvidenceRows = (
  snapshot: SsbjReportSnapshotV1,
  trail: SsbjAuditTrailDetails,
  internalRecords: boolean,
): { rows: string[][]; headerRowIndexes: number[] } => {
  const rows: string[][] = [['SSBJ の根拠文書（保存版）']];
  const headerRowIndexes = [rows.length];
  rows.push([
    '根拠文書ID', '項目', '開示する内容',
    ...(internalRecords
      ? ['資料名', '版', '保管先', '参照位置', '主管部署', 'ファイル名', 'SHA-256', '保管先での版', '保存担当', '記録日時']
      : []),
  ]);
  for (const evidence of snapshot.sections.evidence ?? []) {
    const item = isSsbjItemId(evidence.itemId) ? findSsbjNarrativeItem(evidence.itemId) : undefined;
    rows.push([
      evidence.id, item?.label ?? evidence.itemId,
      evidence.disclosure.state === 'answered' ? evidence.disclosure.value : '',
      ...(internalRecords
        ? [
          evidence.documentTitle, evidence.documentVersion ?? '', evidence.internalLocation ?? '', evidence.referencePosition ?? '',
          evidence.ownerDepartment ?? '', evidence.fileName ?? '', evidence.fileSha256 ?? '', evidence.fileStorageVersionId ?? '',
          evidence.fileStoredBy ?? '', evidence.fileRecordedAt ?? '',
        ]
        : []),
    ]);
  }
  if (!internalRecords) {
    rows.push(['資料名・保管先・ファイルの SHA-256 などは内部記録のため出していません（出力のときに「内部メモ・内部記録を含める」を選ぶと出ます）']);
  }

  const files = new Map<string, { fileName: string; sha256: string; records: string[] }>();
  for (const detail of trail.details) {
    for (const file of detail.evidenceFiles) {
      const entry = files.get(file.id) ?? { fileName: file.fileName, sha256: file.sha256, records: [] };
      entry.records.push(detail.activityRecordId);
      files.set(file.id, entry);
    }
  }
  rows.push([], ['活動量に紐づく帳票（出力時点の OGT）']);
  headerRowIndexes.push(rows.length);
  rows.push(['帳票ID', 'ファイル名', 'SHA-256', '紐づく活動量の件数', '紐づく活動量ID']);
  for (const [id, file] of files) {
    rows.push([id, file.fileName, file.sha256, String(file.records.length), file.records.join('、')]);
  }
  if (files.size === 0) rows.push(['活動量に紐づく帳票はありません']);
  return { rows, headerRowIndexes };
};

/** 操作履歴のシートの行（操作履歴の画面の出力と同じ形）。 */
export const trailAuditRows = (
  logs: readonly SsbjAuditLog[],
  nameOf: (userId: string | null) => string,
  reportTitle: string,
  generatedAt: string,
): string[][] => ssbjAuditExportRows(logs, nameOf, reportTitle, generatedAt);
