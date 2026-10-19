// 公式排出係数の年度ごとの定義（data/<年度>/source.json）の読み込みと検証のテスト。
// 年度の追加は「data/<年度>/ に公表資料と source.json を置く」だけで済み、導入先が手で書くファイルのため、
// 書式の誤りや差し替え忘れを、どのファイルのどの項目かを示して止めることを固定する。

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DenkiParseResult, ProviderFactorRow, SimpleFactorRow } from '../parse.ts';
import {
  assertDistinctDocuments,
  loadYearSources,
  parseYearSource,
  runYearSourceChecks,
  type ParsedYearData,
} from '../yearSource.ts';

const DATA_ROOT = path.join(process.cwd(), 'scripts/official-factors/data');

const validSource = () => ({
  documents: {
    denki: '電気事業者別排出係数 R5年度実績',
    gas: 'ガス事業者別排出係数 R5年度供給実績',
    heat: '熱供給事業者別排出係数 R5年度供給実績',
    fuels: '算定方法・排出係数一覧',
    scope3: '排出原単位データベース Ver.3.5',
  },
  scope3DatabaseVersion: 'Ver.3.5',
  cityGasSubstituteValue: 2.05,
  heatSubstituteValue: 0.0532,
});

const provider = (overrides: Partial<ProviderFactorRow>): ProviderFactorRow => ({
  providerName: '事業者',
  providerNumber: 'A0001',
  menuName: null,
  basic: 0.0004,
  adjusted: 0.0003,
  ...overrides,
} as ProviderFactorRow);

const parsedData = (): ParsedYearData => ({
  denki: {
    retailerCount: 2,
    retailers: [
      provider({ providerNumber: 'A0002', basic: 0.000422 }),
      provider({ providerNumber: 'A0269', menuName: 'メニューM(残差)', adjusted: 0.000452 }),
    ],
    gridOperators: [provider({ providerName: '沖縄電力株式会社', providerNumber: '', basic: 0.000707 })],
    substituteValue: 0.000416,
  } as unknown as DenkiParseResult,
  gasProviders: [provider({ providerNumber: 'K0052', basic: 2.91 })],
  heatProviders: [provider({ providerNumber: '032', basic: 0.0584 })],
  fuels: [{ name: '灯油', value: 2.5 } as SimpleFactorRow],
  scope3: [],
});

describe('parseYearSource', () => {
  it('必須項目がそろっていれば年度とディレクトリを付けて返し、checks は省略できる', () => {
    const source = parseYearSource(validSource(), 2024, '/data/2024');
    expect(source).toMatchObject({ year: 2024, dataDir: '/data/2024', scope3DatabaseVersion: 'Ver.3.5' });
    expect(source.checks.electricityRetailers).toBeUndefined();
  });

  it('公表資料名の欠落・数値でない代替値・checks の書式誤りを、ファイルと項目を示して止める', () => {
    const { documents, ...rest } = validSource();
    expect(() => parseYearSource({ ...rest, documents: { ...documents, fuels: '' } }, 2024, '/d')).toThrow(
      '2024/source.json の documents.fuels（公表資料名）がありません',
    );
    expect(() => parseYearSource({ ...validSource(), cityGasSubstituteValue: '2.05' }, 2024, '/d')).toThrow(
      '2024/source.json の cityGasSubstituteValue は数値で書いてください',
    );
    expect(() => parseYearSource({ ...validSource(), checks: { fuelCount: '35' } }, 2024, '/d')).toThrow(
      '2024/source.json の checks.fuelCount は数値で書いてください',
    );
    expect(() =>
      parseYearSource({ ...validSource(), checks: { gasProviders: [{ providerNumber: 'K0052' }] } }, 2024, '/d'),
    ).toThrow('2024/source.json の checks.gasProviders[0] の書式が正しくありません');
  });
});

describe('runYearSourceChecks', () => {
  const sourceWithChecks = (checks: object) =>
    parseYearSource({ ...validSource(), checks }, 2024, '/d');

  it('書かれたスポットチェックがすべて一致すれば通る（menuName を書いたときだけメニューも突き合わせる）', () => {
    const source = sourceWithChecks({
      gridOperatorCount: 1,
      electricitySubstituteValue: 0.000416,
      electricityRetailers: [
        { providerNumber: 'A0002', menuName: null, factorType: 'basic', value: 0.000422, label: 'A0002 の基礎係数' },
        { providerNumber: 'A0269', menuName: 'メニューM(残差)', factorType: 'adjusted', value: 0.000452, label: 'A0269 の調整後係数' },
      ],
      gridOperators: [{ nameIncludes: '沖縄', factorType: 'basic', value: 0.000707, label: '沖縄電力の係数' }],
      gasProviders: [{ providerNumber: 'K0052', factorType: 'basic', value: 2.91, label: 'K0052 の係数' }],
      fuels: [{ name: '灯油', value: 2.5 }],
    });
    expect(() => runYearSourceChecks(source, parsedData())).not.toThrow();
  });

  it('値の不一致・件数の不足は、年度と期待値を示して止める', () => {
    expect(() =>
      runYearSourceChecks(sourceWithChecks({ fuels: [{ name: '灯油', value: 9.9 }] }), parsedData()),
    ).toThrow('2024年度 灯油の係数が一致しません（期待値 9.9・実際 2.5）');
    expect(() =>
      runYearSourceChecks(sourceWithChecks({ electricityRetailerCountAtLeast: 400 }), parsedData()),
    ).toThrow('2024年度 小売電気事業者数が少なすぎます: 2');
    expect(() =>
      runYearSourceChecks(
        sourceWithChecks({
          gasProviders: [{ providerNumber: 'K9999', factorType: 'basic', value: 1, label: 'K9999 の係数' }],
        }),
        parsedData(),
      ),
    ).toThrow('2024年度 K9999 の係数が一致しません（期待値 1・実際 なし）');
  });
});

describe('assertDistinctDocuments', () => {
  it('電気・ガス・熱の公表資料名が別年度と同じなら、差し替え忘れとして止める', () => {
    const a = parseYearSource(validSource(), 2024, '/a');
    const b = parseYearSource(validSource(), 2025, '/b');
    expect(() => assertDistinctDocuments([a, b])).toThrow('denki の公表資料名が複数年度で同じです');
  });
});

describe('loadYearSources', () => {
  let root: string | null = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  const makeRoot = (years: Record<string, object | null>): string => {
    root = mkdtempSync(path.join(tmpdir(), 'ogt-year-source-'));
    for (const [year, source] of Object.entries(years)) {
      mkdirSync(path.join(root, year));
      if (source) writeFileSync(path.join(root, year, 'source.json'), JSON.stringify(source));
    }
    mkdirSync(path.join(root, 'notes'));
    return root;
  };

  it('4 桁の年度ディレクトリだけを年度の昇順で読む', () => {
    const second = validSource();
    second.documents = { ...second.documents, denki: '別の公表回', gas: '別の公表回（ガス）', heat: '別の公表回（熱）' };
    const sources = loadYearSources(makeRoot({ '2025': second, '2024': validSource() }));
    expect(sources.map((source) => source.year)).toEqual([2024, 2025]);
  });

  it('source.json の無い年度ディレクトリは置き忘れとして止める', () => {
    expect(() => loadYearSources(makeRoot({ '2024': null }))).toThrow('2024/source.json がありません');
  });

  it('リポジトリの data/ の年度の定義はすべて読める', () => {
    const sources = loadYearSources(DATA_ROOT);
    expect(sources.map((source) => source.year)).toContain(2025);
  });
});
