// IDEA 製品検索サービスのテスト（docs/idea-scope3-spec.md §4.2）。
// サーバーサイド ilike・active インポート限定・JPN 優先・上限50件を検証する。

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IDEA_PRODUCT_SEARCH_LIMIT,
  escapeIlikePattern,
  quoteOrFilterValue,
  searchIdeaProducts,
  toIdeaProductOptions,
} from '../ideaProductSearch';

describe('escapeIlikePattern', () => {
  it('ilike のメタ文字（% _ \\）をエスケープする', () => {
    expect(escapeIlikePattern('100%鋼_材\\')).toBe('100\\%鋼\\_材\\\\');
  });

  it('通常の検索語は変更しない', () => {
    expect(escapeIlikePattern('鋼材')).toBe('鋼材');
  });
});

describe('quoteOrFilterValue', () => {
  it('or 構文の区切り文字（, ( )）を含む値をダブルクォートで無害化する', () => {
    expect(quoteOrFilterValue('%鋼材, 冷延(めっき)%')).toBe('"%鋼材, 冷延(めっき)%"');
  });

  it('クォート内の \\ と " をバックスラッシュでエスケープする', () => {
    expect(quoteOrFilterValue('%a\\%b"c%')).toBe('"%a\\\\%b\\"c%"');
  });
});

describe('toIdeaProductOptions', () => {
  it('SearchableSelect の候補形式（コードでも製品名でも検索可能）へ変換する', () => {
    expect(
      toIdeaProductOptions([
        { id: 'f-1', ideaCode: '000000001mXXX', productName: 'ダミー製品A', country: 'JPN', unit: 'kg' },
      ]),
    ).toEqual([
      {
        value: 'f-1',
        label: 'ダミー製品A（JPN / kg）',
        searchText: '000000001mXXX ダミー製品A',
      },
    ]);
  });
});

interface CapturedQuery {
  filters: [string, unknown][];
  neqFilters: [string, unknown][];
  or: string | null;
  limit: number | null;
  select: string;
}

/** 検索クエリの組み立てを記録して固定結果を返す Supabase クライアントのスタブ */
const createFakeSearchClient = (resultsByCountryScope: {
  jpn: Record<string, unknown>[];
  other: Record<string, unknown>[];
}) => {
  const captured: CapturedQuery[] = [];

  const from = vi.fn(() => {
    const query: CapturedQuery = { filters: [], neqFilters: [], or: null, limit: null, select: '' };
    captured.push(query);
    const builder = {
      select: (columns: string) => {
        query.select = columns;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        query.filters.push([column, value]);
        return builder;
      },
      neq: (column: string, value: unknown) => {
        query.neqFilters.push([column, value]);
        return builder;
      },
      or: (filter: string) => {
        query.or = filter;
        return builder;
      },
      order: () => builder,
      limit: (count: number) => {
        query.limit = count;
        const isJpn = query.filters.some(([column, value]) => column === 'country' && value === 'JPN');
        const rows = isJpn ? resultsByCountryScope.jpn : resultsByCountryScope.other;
        return Promise.resolve({ data: rows.slice(0, count), error: null });
      },
    };
    return builder;
  });

  return { client: { from } as unknown as SupabaseClient, captured };
};

const jpnRow = (index: number) => ({
  id: `jpn-${index}`,
  ideaCode: `00000000${index}mXXX`,
  productName: `ダミー製品${index}`,
  country: 'JPN',
  unit: 'kg',
});

const gloRow = (index: number) => ({
  id: `glo-${index}`,
  ideaCode: `10000000${index}mXXX`,
  productName: `ダミー製品G${index}`,
  country: 'GLO',
  unit: 'kg',
});

describe('searchIdeaProducts', () => {
  it('active インポートのみを対象に、サーバーサイド ilike で検索する（§4.2）', async () => {
    const { client, captured } = createFakeSearchClient({ jpn: [jpnRow(1)], other: [] });

    const results = await searchIdeaProducts('鋼', { client });

    expect(results).toEqual([
      { id: 'jpn-1', ideaCode: '000000001mXXX', productName: 'ダミー製品1', country: 'JPN', unit: 'kg' },
    ]);
    // !inner 結合 + isActive フィルタで active インポート限定にしている
    expect(captured[0].select).toContain('idea_imports!inner');
    expect(captured[0].filters).toContainEqual(['idea_imports.isActive', true]);
    // 製品名・IDEA製品コードのどちらでも当たる OR 条件
    //（UI の「製品名またはIDEA製品コードで検索」表記と対応）
    expect(captured[0].or).toBe('productName.ilike."%鋼%",ideaCode.ilike."%鋼%"');
  });

  it('IDEA製品コードでの検索も同じ OR 条件でサーバーへ渡る', async () => {
    const { client, captured } = createFakeSearchClient({ jpn: [jpnRow(1)], other: [] });

    await searchIdeaProducts('999999999mJPN', { client });

    expect(captured[0].or).toBe(
      'productName.ilike."%999999999mJPN%",ideaCode.ilike."%999999999mJPN%"',
    );
  });

  it('or 構文の区切り文字を含むキーワードはクォートしてフィルタ文字列を壊さない', async () => {
    const { client, captured } = createFakeSearchClient({ jpn: [], other: [] });

    await searchIdeaProducts('鋼材, 冷延(めっき)', { client });

    expect(captured[0].or).toBe(
      'productName.ilike."%鋼材, 冷延(めっき)%",ideaCode.ilike."%鋼材, 冷延(めっき)%"',
    );
  });

  it('JPN を優先し、残枠を JPN 以外で補完する（§4.2）', async () => {
    const { client, captured } = createFakeSearchClient({
      jpn: [jpnRow(1), jpnRow(2)],
      other: [gloRow(1), gloRow(2), gloRow(3)],
    });

    const results = await searchIdeaProducts('', { client, limit: 4 });

    expect(results.map((row) => row.id)).toEqual(['jpn-1', 'jpn-2', 'glo-1', 'glo-2']);
    // 1回目は JPN（limit=4）、2回目は JPN 以外（残枠 limit=2）
    expect(captured[0].filters).toContainEqual(['country', 'JPN']);
    expect(captured[0].limit).toBe(4);
    expect(captured[1].neqFilters).toContainEqual(['country', 'JPN']);
    expect(captured[1].limit).toBe(2);
  });

  it('JPN だけで上限（既定50件）に達した場合は2回目のクエリを発行しない', async () => {
    const manyJpn = Array.from({ length: IDEA_PRODUCT_SEARCH_LIMIT }, (_, index) => jpnRow(index));
    const { client, captured } = createFakeSearchClient({ jpn: manyJpn, other: [gloRow(1)] });

    const results = await searchIdeaProducts('', { client });

    expect(results).toHaveLength(IDEA_PRODUCT_SEARCH_LIMIT);
    expect(results.every((row) => row.country === 'JPN')).toBe(true);
    expect(captured).toHaveLength(1);
  });
});
