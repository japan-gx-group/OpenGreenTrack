// 公式排出係数の年度ごとの定義（data/<年度>/source.json）の読み込みと検証。
//
// 年度の追加は「data/<年度>/ に公表資料と source.json を置く」だけで済み、generate.ts を変更しない。
// OSS の導入先が過年度（リポジトリに同梱しない年度）を公的データから取得して自分で登録しても、
// コードや OSS 側の年度の生成物と衝突しないようにするため（手順は README.md「過年度の公式係数を自分で登録する」）。
//
// source.json には、公表資料から機械的に読み取れない年度ごとの値（各行に保存する公表資料名・
// 都市ガスと熱の代替値・排出原単位 DB の版）と、パース結果を公表資料と突き合わせるスポットチェックの期待値を書く。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DenkiParseResult, ProviderFactorRow, SimpleFactorRow } from './parse.ts';

export const YEAR_SOURCE_FILE = 'source.json';

export const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`検証エラー: ${message}`);
  }
};

/** data/<年度>/ をパースした結果（年度ごとのスポットチェックに渡す） */
export interface ParsedYearData {
  denki: DenkiParseResult;
  gasProviders: ProviderFactorRow[];
  heatProviders: ProviderFactorRow[];
  fuels: SimpleFactorRow[];
  scope3: SimpleFactorRow[];
}

/** 事業者別係数のスポットチェック 1 件。menuName を書いたときだけメニューも突き合わせる */
interface ProviderSpotCheck {
  providerNumber: string;
  menuName?: string | null;
  factorType: 'basic' | 'adjusted';
  value: number;
  /** 失敗時のメッセージに使う名前（例: 'A0002 イーレックスの基礎係数'） */
  label: string;
}

/** 一般送配電事業者のスポットチェック 1 件（登録番号を持たないため事業者名の部分一致で探す） */
interface GridOperatorSpotCheck {
  nameIncludes: string;
  factorType: 'basic' | 'adjusted';
  value: number;
  label: string;
}

interface FuelSpotCheck {
  name: string;
  value: number;
}

/**
 * パース結果の妥当性検証。すべて任意（書いた項目だけ検証する）。件数の下限は公表資料の規模の目安で、
 * 書式の読み違いで行が大きく欠けたまま生成するのを防ぐ。値のスポットチェックは公表資料と突き合わせて書く。
 */
export interface YearSourceChecks {
  electricityRetailerCountAtLeast?: number;
  electricityRetailerRowsAtLeast?: number;
  gridOperatorCount?: number;
  gasProviderCountAtLeast?: number;
  heatProviderCountAtLeast?: number;
  fuelCount?: number;
  scope3CountAtLeast?: number;
  electricitySubstituteValue?: number;
  electricityRetailers?: ProviderSpotCheck[];
  gridOperators?: GridOperatorSpotCheck[];
  gasProviders?: ProviderSpotCheck[];
  heatProviders?: ProviderSpotCheck[];
  fuels?: FuelSpotCheck[];
}

/**
 * 1 年度分の公表資料の定義。行はこの年度の data/<year>/ と、この定義だけから作る
 * （ほかの年度の資料を使い回すと、ID が同じ過年度の行が upsert で別年度の値に書き換わるため）。
 */
export interface YearSource {
  /** applicableYear（温対法年度。effectiveFrom = year-04-01 / effectiveTo = (year+1)-03-31）。ディレクトリ名から取る */
  year: number;
  /** data/<year>/ の絶対パス */
  dataDir: string;
  /** 出典として各行に保存する公表資料の名称（公表回・実績年度は年度ごとに違う） */
  documents: { denki: string; gas: string; heat: string; fuels: string; scope3: string };
  /** 生成 SQL のヘッダ（出典表示）に載せる排出原単位データベースの版 */
  scope3DatabaseVersion: string;
  /** 都市ガス・熱の代替値（省令の排出係数。事業者別の公表資料には載らないため年度ごとに書く） */
  cityGasSubstituteValue: number;
  heatSubstituteValue: number;
  checks: YearSourceChecks;
}

const DOCUMENT_KEYS = ['denki', 'gas', 'heat', 'fuels', 'scope3'] as const;
const COUNT_CHECK_KEYS = [
  'electricityRetailerCountAtLeast',
  'electricityRetailerRowsAtLeast',
  'gridOperatorCount',
  'gasProviderCountAtLeast',
  'heatProviderCountAtLeast',
  'fuelCount',
  'scope3CountAtLeast',
  'electricitySubstituteValue',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** スポットチェックの配列を検証する（書かれていなければ undefined） */
const parseSpotChecks = <T>(
  value: unknown,
  where: string,
  isValid: (item: Record<string, unknown>) => boolean,
): T[] | undefined => {
  if (value === undefined) return undefined;
  assert(Array.isArray(value), `${where} は配列で書いてください`);
  (value as unknown[]).forEach((item, index) => {
    assert(isRecord(item) && isValid(item), `${where}[${index}] の書式が正しくありません`);
  });
  return value as T[];
};

const isFactorType = (value: unknown): boolean => value === 'basic' || value === 'adjusted';

const isProviderSpotCheck = (item: Record<string, unknown>): boolean =>
  typeof item.providerNumber === 'string' &&
  (item.menuName === undefined || item.menuName === null || typeof item.menuName === 'string') &&
  isFactorType(item.factorType) &&
  isFiniteNumber(item.value) &&
  typeof item.label === 'string';

/**
 * source.json の中身を検証して YearSource にする。書式の誤りは、どのファイルのどの項目かを示して止める
 * （導入先が手で書くファイルのため、黙って既定値で生成しない）。
 */
export const parseYearSource = (raw: unknown, year: number, dataDir: string): YearSource => {
  const where = `${year}/${YEAR_SOURCE_FILE}`;
  assert(isRecord(raw), `${where} はオブジェクトで書いてください`);
  const source = raw as Record<string, unknown>;

  assert(isRecord(source.documents), `${where} に documents（公表資料名）がありません`);
  const documents = source.documents as Record<string, unknown>;
  for (const key of DOCUMENT_KEYS) {
    const name = documents[key];
    assert(typeof name === 'string' && name.trim() !== '', `${where} の documents.${key}（公表資料名）がありません`);
  }

  assert(
    typeof source.scope3DatabaseVersion === 'string' && source.scope3DatabaseVersion.trim() !== '',
    `${where} に scope3DatabaseVersion（排出原単位 DB の版）がありません`,
  );
  assert(isFiniteNumber(source.cityGasSubstituteValue), `${where} の cityGasSubstituteValue は数値で書いてください`);
  assert(isFiniteNumber(source.heatSubstituteValue), `${where} の heatSubstituteValue は数値で書いてください`);

  const rawChecks = source.checks ?? {};
  assert(isRecord(rawChecks), `${where} の checks はオブジェクトで書いてください`);
  const checksRecord = rawChecks as Record<string, unknown>;
  for (const key of COUNT_CHECK_KEYS) {
    const value = checksRecord[key];
    assert(value === undefined || isFiniteNumber(value), `${where} の checks.${key} は数値で書いてください`);
  }
  const checks: YearSourceChecks = {
    ...(Object.fromEntries(
      COUNT_CHECK_KEYS.filter((key) => checksRecord[key] !== undefined).map((key) => [key, checksRecord[key]]),
    ) as Partial<Record<(typeof COUNT_CHECK_KEYS)[number], number>>),
    electricityRetailers: parseSpotChecks<ProviderSpotCheck>(
      checksRecord.electricityRetailers,
      `${where} の checks.electricityRetailers`,
      isProviderSpotCheck,
    ),
    gridOperators: parseSpotChecks<GridOperatorSpotCheck>(
      checksRecord.gridOperators,
      `${where} の checks.gridOperators`,
      (item) =>
        typeof item.nameIncludes === 'string' &&
        isFactorType(item.factorType) &&
        isFiniteNumber(item.value) &&
        typeof item.label === 'string',
    ),
    gasProviders: parseSpotChecks<ProviderSpotCheck>(
      checksRecord.gasProviders,
      `${where} の checks.gasProviders`,
      isProviderSpotCheck,
    ),
    heatProviders: parseSpotChecks<ProviderSpotCheck>(
      checksRecord.heatProviders,
      `${where} の checks.heatProviders`,
      isProviderSpotCheck,
    ),
    fuels: parseSpotChecks<FuelSpotCheck>(
      checksRecord.fuels,
      `${where} の checks.fuels`,
      (item) => typeof item.name === 'string' && isFiniteNumber(item.value),
    ),
  };

  return {
    year,
    dataDir,
    documents: {
      denki: documents.denki as string,
      gas: documents.gas as string,
      heat: documents.heat as string,
      fuels: documents.fuels as string,
      scope3: documents.scope3 as string,
    },
    scope3DatabaseVersion: source.scope3DatabaseVersion as string,
    cityGasSubstituteValue: source.cityGasSubstituteValue as number,
    heatSubstituteValue: source.heatSubstituteValue as number,
    checks,
  };
};

const findProvider = (rows: ProviderFactorRow[], check: ProviderSpotCheck): ProviderFactorRow | undefined =>
  rows.find(
    (row) => row.providerNumber === check.providerNumber && (check.menuName === undefined || row.menuName === check.menuName),
  );

const assertProviderValue = (row: ProviderFactorRow | undefined, check: { factorType: 'basic' | 'adjusted'; value: number; label: string }, year: number): void => {
  const actual = row ? (check.factorType === 'basic' ? row.basic : row.adjusted) : undefined;
  assert(actual === check.value, `${year}年度 ${check.label}が一致しません（期待値 ${check.value}・実際 ${actual ?? 'なし'}）`);
};

/** パース結果を source.json の checks と突き合わせる（書かれた項目だけ）。 */
export const runYearSourceChecks = (source: YearSource, data: ParsedYearData): void => {
  const { checks, year } = source;
  const { denki, gasProviders, heatProviders, fuels, scope3 } = data;
  const distinctProviders = (rows: ProviderFactorRow[]): number => new Set(rows.map((row) => row.providerNumber)).size;

  if (checks.electricityRetailerCountAtLeast !== undefined) {
    assert(denki.retailerCount >= checks.electricityRetailerCountAtLeast, `${year}年度 小売電気事業者数が少なすぎます: ${denki.retailerCount}`);
  }
  if (checks.electricityRetailerRowsAtLeast !== undefined) {
    assert(denki.retailers.length >= checks.electricityRetailerRowsAtLeast, `${year}年度 電気の係数行が少なすぎます: ${denki.retailers.length}`);
  }
  if (checks.gridOperatorCount !== undefined) {
    assert(
      denki.gridOperators.length === checks.gridOperatorCount,
      `${year}年度 一般送配電事業者は${checks.gridOperatorCount}社のはず: ${denki.gridOperators.length}`,
    );
  }
  if (checks.gasProviderCountAtLeast !== undefined) {
    assert(distinctProviders(gasProviders) >= checks.gasProviderCountAtLeast, `${year}年度 ガス事業者数が少なすぎます: ${distinctProviders(gasProviders)}`);
  }
  if (checks.heatProviderCountAtLeast !== undefined) {
    assert(distinctProviders(heatProviders) >= checks.heatProviderCountAtLeast, `${year}年度 熱供給事業者数が少なすぎます: ${distinctProviders(heatProviders)}`);
  }
  if (checks.fuelCount !== undefined) {
    assert(fuels.length === checks.fuelCount, `${year}年度 燃料は${checks.fuelCount}種のはず: ${fuels.length}`);
  }
  if (checks.scope3CountAtLeast !== undefined) {
    assert(scope3.length >= checks.scope3CountAtLeast, `${year}年度 Scope3原単位が少なすぎます: ${scope3.length}`);
  }
  if (checks.electricitySubstituteValue !== undefined) {
    assert(
      denki.substituteValue === checks.electricitySubstituteValue,
      `${year}年度 電気の代替値が想定と異なります: ${denki.substituteValue}`,
    );
  }
  for (const check of checks.electricityRetailers ?? []) {
    assertProviderValue(findProvider(denki.retailers, check), check, year);
  }
  for (const check of checks.gridOperators ?? []) {
    assertProviderValue(denki.gridOperators.find((row) => row.providerName.includes(check.nameIncludes)), check, year);
  }
  for (const check of checks.gasProviders ?? []) {
    assertProviderValue(findProvider(gasProviders, check), check, year);
  }
  for (const check of checks.heatProviders ?? []) {
    assertProviderValue(findProvider(heatProviders, check), check, year);
  }
  for (const check of checks.fuels ?? []) {
    const actual = fuels.find((fuel) => fuel.name === check.name)?.value;
    assert(actual === check.value, `${year}年度 ${check.name}の係数が一致しません（期待値 ${check.value}・実際 ${actual ?? 'なし'}）`);
  }
};

/**
 * data/ 配下の年度ディレクトリ（4 桁の数字で、source.json を持つもの）から年度の定義を読み、年度の昇順で返す。
 * source.json の無い年度ディレクトリは、置き忘れとして止める（黙って飛ばすとその年度が生成されない）。
 */
export const loadYearSources = (dataRoot: string): YearSource[] => {
  const years = readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((a, b) => a - b);
  assert(years.length > 0, `年度のディレクトリ（data/<年度>/）が 1 つもありません: ${dataRoot}`);

  const sources = years.map((year) => {
    const dataDir = join(dataRoot, String(year));
    const sourcePath = join(dataDir, YEAR_SOURCE_FILE);
    assert(existsSync(sourcePath), `${year}/${YEAR_SOURCE_FILE} がありません（年度の定義を置いてください）`);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
    } catch (error) {
      throw new Error(`検証エラー: ${year}/${YEAR_SOURCE_FILE} を JSON として読めません: ${(error as Error).message}`);
    }
    return parseYearSource(raw, year, dataDir);
  });

  assertDistinctDocuments(sources);
  return sources;
};

/**
 * 電気・ガス・熱は毎年度公表し直される。公表資料名が別年度と同じなら、前年度の定義を写して
 * 新年度の資料に差し替え忘れている（過年度と同じ値を新年度として登録してしまう）。
 */
export const assertDistinctDocuments = (sources: readonly YearSource[]): void => {
  for (const key of ['denki', 'gas', 'heat'] as const) {
    const names = sources.map((source) => source.documents[key]);
    assert(
      new Set(names).size === names.length,
      `${key} の公表資料名が複数年度で同じです（新年度の資料に差し替えたか確認してください）`,
    );
  }
};
