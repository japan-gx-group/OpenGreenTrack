import { describe, expect, it } from 'vitest';
import type { EmissionFactor } from '../../services/factorService';
import { isExternalHttpUrl, STANDARD_SOURCES, summarizeFactorSources } from '../factorSources';

type SummaryInput = Pick<EmissionFactor, 'source' | 'sourceDocument' | 'sourceUrl'>;

const factor = (
  source: string,
  sourceDocument?: string,
  sourceUrl?: string,
): SummaryInput => ({ source, sourceDocument, sourceUrl });

const SHK_URL = 'https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html';
const SCOPE3_URL = 'https://policies.env.go.jp/earth/ghg-santeikohyo/supply_chain.html';

describe('summarizeFactorSources', () => {
  it('ソースごとに distinct な（資料名, URL）の組を集計する', () => {
    const [moe] = summarizeFactorSources(
      [
        factor('環境省', '算定方法・排出係数一覧', SHK_URL),
        factor('環境省', '算定方法・排出係数一覧', SHK_URL),
        factor('環境省', '排出原単位データベース Ver.3.6', SCOPE3_URL),
      ],
      [STANDARD_SOURCES[0]],
    );

    expect(moe.totalCount).toBe(3);
    expect(moe.documents).toEqual([
      { documentName: '算定方法・排出係数一覧', url: SHK_URL, count: 2 },
      { documentName: '排出原単位データベース Ver.3.6', url: SCOPE3_URL, count: 1 },
    ]);
  });

  it('資料名が同じでもURLが異なれば別の出典として扱う', () => {
    const [moe] = summarizeFactorSources(
      [
        factor('環境省', '排出原単位データベース', SCOPE3_URL),
        factor('環境省', '排出原単位データベース', SHK_URL),
      ],
      [STANDARD_SOURCES[0]],
    );

    expect(moe.documents).toHaveLength(2);
  });

  it('件数の多い順、同数なら資料名順に並ぶ', () => {
    const [moe] = summarizeFactorSources(
      [
        factor('環境省', 'B資料', SHK_URL),
        factor('環境省', 'A資料', SCOPE3_URL),
        factor('環境省', 'C資料', 'https://example.com/c'),
        factor('環境省', 'C資料', 'https://example.com/c'),
      ],
      [STANDARD_SOURCES[0]],
    );

    expect(moe.documents.map((document) => document.documentName)).toEqual(['C資料', 'A資料', 'B資料']);
  });

  it('出典未設定の係数は「出典なし」の1件にまとまり末尾に並ぶ', () => {
    const [custom] = summarizeFactorSources(
      [
        factor('自社設定'),
        factor('自社設定', '   ', '  '),
        factor('自社設定', '社内実測記録', 'https://example.com/internal'),
      ],
      [STANDARD_SOURCES[4]],
    );

    expect(custom.totalCount).toBe(3);
    expect(custom.documents).toEqual([
      { documentName: '社内実測記録', url: 'https://example.com/internal', count: 1 },
      { documentName: undefined, url: undefined, count: 2 },
    ]);
  });

  it('URLの無い資料名だけの出典も1件として保持する', () => {
    const [custom] = summarizeFactorSources(
      [factor('自社設定'), factor('自社設定', '社内算定根拠メモ')],
      [STANDARD_SOURCES[4]],
    );

    expect(custom.documents).toEqual([
      { documentName: '社内算定根拠メモ', url: undefined, count: 1 },
      { documentName: undefined, url: undefined, count: 1 },
    ]);
  });

  // 登録0件のソースを出すと、参照元リンクを開いても該当係数が無く出典を誤認させる。
  it('登録0件のソースは返さない', () => {
    const summaries = summarizeFactorSources([factor('環境省', '算定方法・排出係数一覧', SHK_URL)]);

    expect(summaries.map((summary) => summary.name)).toEqual(['環境省']);
  });

  it('係数が空なら空配列を返す', () => {
    expect(summarizeFactorSources([])).toEqual([]);
  });

  it('STANDARD_SOURCES の並び順を保つ', () => {
    const summaries = summarizeFactorSources(STANDARD_SOURCES.map((source) => factor(source.name)));

    expect(summaries.map((summary) => summary.name)).toEqual(STANDARD_SOURCES.map((source) => source.name));
  });

  it('ソースのメタ情報（説明・アイコン・社内区分）を引き継ぐ', () => {
    const summaries = summarizeFactorSources([factor('環境省'), factor('自社設定')]);

    expect(summaries.find((summary) => summary.name === '環境省')?.description).toBe(STANDARD_SOURCES[0].description);
    expect(summaries.find((summary) => summary.name === '環境省')?.icon).toBe(STANDARD_SOURCES[0].icon);
    // 「公的ソースか社内ソースか」は登録データの有無で変わらない（アイコンの淡色表示に使う）
    expect(summaries.find((summary) => summary.name === '自社設定')?.isInternal).toBe(true);
    expect(summaries.find((summary) => summary.name === '環境省')?.isInternal).toBeUndefined();
  });
});

describe('isExternalHttpUrl', () => {
  it('http(s) の絶対URLだけをリンク化対象とする', () => {
    expect(isExternalHttpUrl('https://policies.env.go.jp/earth/ghg-santeikohyo/calc.html')).toBe(true);
    expect(isExternalHttpUrl('http://example.com/a')).toBe(true);
    expect(isExternalHttpUrl('HTTPS://EXAMPLE.COM/A')).toBe(true);
  });

  it('スキーム無し・非http(s)・未設定はリンク化しない', () => {
    // CSVインポートの自由入力で起こりうる。href に入れるとアプリのオリジンからの相対リンクになる
    expect(isExternalHttpUrl('www.env.go.jp/earth/ondanka/')).toBe(false);
    expect(isExternalHttpUrl('/earth/ghg-santeikohyo/calc.html')).toBe(false);
    expect(isExternalHttpUrl('社内Wiki 参照')).toBe(false);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalHttpUrl(undefined)).toBe(false);
  });
});
