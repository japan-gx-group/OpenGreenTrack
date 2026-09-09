import { describe, expect, it } from 'vitest';
import {
  buildCategories,
  buildDrilldownProducts,
  buildMethodItems,
  buildSuppliers,
  sumCalculatedByCategory,
} from '../scopeAnalysisService';

describe('buildSuppliers', () => {
  it('supplier_emissions の実排出量をそのまま表示し、按分せず排出量降順で返す', () => {
    const result = buildSuppliers([
      {
        id: 'se-1',
        fiscalYearId: 'fy-2024',
        categoryId: 1,
        emissions: 5040,
        suppliers: { id: 'sup-8', name: 'H商事株式会社', primaryDataRate: 50 },
      },
      {
        id: 'se-2',
        fiscalYearId: 'fy-2024',
        categoryId: 1,
        emissions: 12500,
        suppliers: { id: 'sup-1', name: 'Aマテリアル株式会社', primaryDataRate: 85 },
      },
      {
        id: 'se-3',
        fiscalYearId: 'fy-2024',
        categoryId: 1,
        emissions: 7800,
        suppliers: { id: 'sup-2', name: 'Bパッケージ株式会社', primaryDataRate: 78 },
      },
    ]);

    // 排出量降順（12500 > 7800 > 5040）
    expect(result.map(row => row.name)).toEqual([
      'Aマテリアル株式会社',
      'Bパッケージ株式会社',
      'H商事株式会社',
    ]);
    // 同一カテゴリでもサプライヤーごとに異なる実値（按分平均 8446.67 ではない）
    expect(result.map(row => row.emissionsNum)).toEqual([12500, 7800, 5040]);
    // 一覧のキーは supplier_emissions の行ID（重複しない）
    expect(result.map(row => row.id)).toEqual(['se-2', 'se-3', 'se-1']);
    // カテゴリラベルとレートの整形
    expect(result[0].category).toBe('1. 購入した製品・サービス');
    expect(result[0].emissions).toBe('12,500');
    expect(result[0].rate).toBe(85);
  });

  it('文字列で来た排出量・レートを数値化し、レートは四捨五入する', () => {
    const result = buildSuppliers([
      {
        id: 'se-1',
        fiscalYearId: 'fy-2024',
        categoryId: 3,
        emissions: '4700.5',
        suppliers: { id: 'sup-12', name: 'Lケミカル株式会社', primaryDataRate: '44.6' },
      },
    ]);

    expect(result[0].emissionsNum).toBe(4700.5);
    expect(result[0].rate).toBe(45);
    expect(result[0].category).toBe('3. Scope 1,2 に含まれない燃料及びエネルギー');
  });

  it('結合先サプライヤーが null の行（不可視/削除済み）は除外する', () => {
    const result = buildSuppliers([
      {
        id: 'se-1',
        fiscalYearId: 'fy-2024',
        categoryId: 1,
        emissions: 1000,
        suppliers: null,
      },
      {
        id: 'se-2',
        fiscalYearId: 'fy-2024',
        categoryId: 1,
        emissions: 2000,
        suppliers: { id: 'sup-1', name: '表示されるサプライヤー', primaryDataRate: 60 },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('表示されるサプライヤー');
  });

  it('レコードが無ければ空配列を返す（その年度に実績のあるサプライヤーのみ表示）', () => {
    expect(buildSuppliers([])).toEqual([]);
  });
});

describe('buildCategories', () => {
  it('カテゴリ別排出量から構成比を算出し降順に並べる', () => {
    const result = buildCategories([
      { categoryId: 2, emissions: 2500 },
      { categoryId: 1, emissions: 7500 },
    ]);

    expect(result.map(row => row.id)).toEqual([1, 2]);
    expect(result[0].percentage).toBe('75.0%');
    expect(result[1].percentage).toBe('25.0%');
  });
});

describe('sumCalculatedByCategory', () => {
  it('カテゴリ別に合計し、カテゴリ範囲外・null の行は無視する', () => {
    const totals = sumCalculatedByCategory([
      { categoryId: 1, emissions: 1.5 },
      { categoryId: 1, emissions: '2.25' },
      { categoryId: 4, emissions: 10 },
      { categoryId: null, emissions: 99 },
      { categoryId: 16, emissions: 99 },
      { categoryId: 0, emissions: 99 },
    ]);

    expect(totals.get(1)).toBeCloseTo(3.75, 6);
    expect(totals.get(4)).toBe(10);
    expect([...totals.keys()].sort()).toEqual([1, 4]);
  });
});

describe('buildMethodItems', () => {
  it('方式未設定のカテゴリは direct 扱いで直接入力値を採用する（後方互換）', () => {
    const items = buildMethodItems({
      methodRows: [],
      directRows: [{ categoryId: 1, emissions: 100, dataSourceNote: '推計値' }],
      calculatedByCategory: new Map([[1, 5]]),
    });

    expect(items).toHaveLength(15);
    const category1 = items[0];
    expect(category1.method).toBe('direct');
    expect(category1.directEmissions).toBe(100);
    expect(category1.directDataSourceNote).toBe('推計値');
    expect(category1.calculatedEmissions).toBe(5);
    expect(category1.adoptedEmissions).toBe(100);
  });

  it('calculated のカテゴリは積上げ合計を採用し、direct 値は削除せず保持する（可逆性）', () => {
    const items = buildMethodItems({
      methodRows: [{ categoryId: 1, method: 'calculated' }],
      directRows: [{ categoryId: 1, emissions: 100 }],
      calculatedByCategory: new Map([[1, 42.123456]]),
    });

    const category1 = items[0];
    expect(category1.method).toBe('calculated');
    expect(category1.adoptedEmissions).toBeCloseTo(42.123456, 6);
    // 「未採用（積上げ算定を採用中）」表示のため direct 値はそのまま返す。
    expect(category1.directEmissions).toBe(100);
  });

  it('direct 値が未登録（null）のカテゴリの採用値は 0 になる', () => {
    const items = buildMethodItems({
      methodRows: [],
      directRows: [],
      calculatedByCategory: new Map(),
    });

    expect(items[2].directEmissions).toBeNull();
    expect(items[2].adoptedEmissions).toBe(0);
  });
});

describe('buildDrilldownProducts', () => {
  const row = (
    key: string,
    productName: string | null,
    emissions: number,
    amount: number,
    unit: string,
  ) => ({
    emissions,
    ideaFactorId: key,
    appliedFactorName: `${key} スナップショット名`,
    idea_factors: productName ? { productName } : null,
    activity_records: { amount, unit },
  });

  it('製品別に活動量・排出量を集計し、排出量降順・構成比つきで返す', () => {
    const result = buildDrilldownProducts([
      row('f-1', '米', 1, 100, 'kg'),
      row('f-1', '米', 2, 200, 'kg'),
      row('f-2', '鋼材', 9, 50, 'kg'),
    ]);

    expect(result.productCount).toBe(2);
    expect(result.totalEmissions).toBe(12);
    expect(result.products.map(product => product.productName)).toEqual(['鋼材', '米']);
    expect(result.products[1].totalAmount).toBe(300);
    expect(result.products[1].unit).toBe('kg');
    expect(result.products[0].percentage).toBe('75.0%');
  });

  it('参照切れ（idea_factors が null）は appliedFactorName スナップショットで表示する', () => {
    const result = buildDrilldownProducts([
      { emissions: 3, ideaFactorId: null, appliedFactorName: '999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0)', idea_factors: null, activity_records: { amount: 10, unit: 'kg' } },
    ]);

    expect(result.products[0].productName).toBe('999999999mJPN ダミー製品 (AIST-IDEA Ver.4.0)');
  });

  it('上限を超えた製品は「その他」へまとめ、単位が混在した製品は活動量合計を出さない', () => {
    const rows = [
      row('f-1', 'A', 10, 1, 'kg'),
      row('f-2', 'B', 8, 1, 'kg'),
      row('f-3', 'C', 6, 1, 'kg'),
      // 同一製品で単位が混在（kg と t）→ totalAmount は null
      row('f-mixed', 'D', 4, 1, 'kg'),
      { ...row('f-mixed', 'D', 2, 1, 't') },
    ];

    const result = buildDrilldownProducts(rows, 2);

    expect(result.products).toHaveLength(3);
    expect(result.products[2].productName).toBe('その他（2製品）');
    expect(result.products[2].totalEmissions).toBe(12);
    expect(result.productCount).toBe(4);

    const full = buildDrilldownProducts(rows, 10);
    const mixed = full.products.find(product => product.productName === 'D');
    expect(mixed?.totalAmount).toBeNull();
    expect(mixed?.unit).toBeNull();
    expect(mixed?.totalEmissions).toBe(6);
  });
});
