import { describe, expect, it } from 'vitest';
import {
  MANUAL_ACTIVITY_CATEGORIES,
  MANUAL_ACTIVITY_CATEGORY_MAP,
} from '../types';

describe('manual activity category metadata', () => {
  it('offers exactly the manual categories (+ heat, 係数ゼロの 4 種を除外) with fixed units', () => {
    expect(MANUAL_ACTIVITY_CATEGORIES).toEqual([
      'electricity',
      'city_gas',
      // 熱供給事業者別排出係数の整備で追加（単位 GJ）
      'heat',
      'waste',
      'fuel',
      // 出張（カテゴリ6）と通勤（カテゴリ7）は別カテゴリ
      'business_travel',
      'business_travel_commuting',
    ]);

    expect(MANUAL_ACTIVITY_CATEGORIES.map((category) => ({
      category,
      unit: MANUAL_ACTIVITY_CATEGORY_MAP[category].unit,
    }))).toEqual([
      { category: 'electricity', unit: 'kWh' },
      { category: 'city_gas', unit: 'm³' },
      { category: 'heat', unit: 'GJ' },
      { category: 'waste', unit: 't' },
      { category: 'fuel', unit: 'L' },
      // 公式係数（kg-CO2/人・日）と同じ分母にする。km だと換算できず常に未算定になる
      { category: 'business_travel', unit: '人・日' },
      { category: 'business_travel_commuting', unit: '人・日' },
    ]);
  });

  // 「出張・通勤」の 1 本では係数候補が通勤 10 件だけになり、常にカテゴリ7 で計上される。
  it('出張と通勤は別ラベルで、どちらも延べ人日を標準単位にする', () => {
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.business_travel.labelJP).toBe('出張');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.business_travel_commuting.labelJP).toBe('通勤');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.business_travel.unit).toBe('人・日');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.business_travel_commuting.unit).toBe('人・日');
  });

  // 公式係数が 1 件も無いカテゴリは選択肢に出さない（入力しても未算定のままになるため）。
  // 既存レコードの履歴表示のためラベルと単位は残す。
  it('公式係数ゼロの 4 種は手動入力カテゴリ外だが表示ラベルを持つ', () => {
    for (const category of ['vehicle', 'logistics', 'purchased_goods_services', 'supplier_data'] as const) {
      expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain(category);
    }
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.vehicle).toEqual({ labelJP: '車両', unit: 'km' });
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.logistics).toEqual({ labelJP: '物流', unit: 't-km' });
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.purchased_goods_services).toEqual({
      labelJP: '購入した製品・サービス',
      unit: '円',
    });
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.supplier_data).toEqual({
      labelJP: 'サプライヤーデータ',
      unit: 't-CO2e',
    });
  });

  it('keeps display metadata for legacy enum values outside the manual selector', () => {
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('fuel_heavy_oil');
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('fuel_diesel');
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('water');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.fuel_heavy_oil).toEqual({ labelJP: '重油', unit: 'L' });
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.fuel_diesel).toEqual({ labelJP: '軽油', unit: 'L' });
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.water).toEqual({ labelJP: '水道', unit: 'm3' });
  });

  // Scope3積上げは専用の入力モードで扱い、通常の手動入力カテゴリには出さない。
  it('scope3_activity は手動入力カテゴリ外だが表示ラベルを持つ', () => {
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('scope3_activity');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.scope3_activity.labelJP).toBe('Scope3積上げ');
  });
});
