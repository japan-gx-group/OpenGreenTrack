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
      // 主要燃料（公式係数は細目の種別で同梱している）
      'fuel_gasoline',
      'fuel_diesel',
      'fuel_kerosene',
      'fuel_heavy_oil',
      'fuel_lpg',
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
      // 公式係数（tCO2/kL）へは L → kL で換算する
      { category: 'fuel_gasoline', unit: 'L' },
      { category: 'fuel_diesel', unit: 'L' },
      { category: 'fuel_kerosene', unit: 'L' },
      { category: 'fuel_heavy_oil', unit: 'L' },
      // 公式係数が tCO2/t のため重さで入力する
      { category: 'fuel_lpg', unit: 't' },
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
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('water');
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('fuel_jet');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.water).toEqual({ labelJP: '水道', unit: 'm3' });
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.fuel_jet).toEqual({ labelJP: 'ジェット燃料油', unit: 'L' });
  });

  // ガソリンなどと並ぶため、細目以外の燃料であることが分かる名前にする（排出係数管理の種別表示と同じ）。
  it('細目以外の燃料（fuel）は「燃料（その他）」と表示する', () => {
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.fuel.labelJP).toBe('燃料（その他）');
  });

  // 重油は A重油と B・C重油が同じ優先度の候補になり、選ばないと未算定になる。LPG は重さで入力する。
  it('重油と LPG は入力欄の下に数え方を案内する', () => {
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.fuel_heavy_oil.amountGuide).toContain('A重油と B・C重油');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.fuel_lpg.amountGuide).toContain('500 kg → 0.5 t');
  });

  // Scope3積上げは専用の入力モードで扱い、通常の手動入力カテゴリには出さない。
  it('scope3_activity は手動入力カテゴリ外だが表示ラベルを持つ', () => {
    expect(MANUAL_ACTIVITY_CATEGORIES).not.toContain('scope3_activity');
    expect(MANUAL_ACTIVITY_CATEGORY_MAP.scope3_activity.labelJP).toBe('Scope3積上げ');
  });
});
