import { describe, expect, it } from 'vitest';
import {
  scope3AdoptedCategoryId,
  scope3DirectMethodNoticeText,
  scope3MethodKey,
} from '../scope3Adoption';

describe('scope3AdoptedCategoryId', () => {
  it('IDEA 積上げは選択したカテゴリをそのまま返す（係数の scope に依らない）', () => {
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'scope3', categoryId: 11 },
        appliedFactorScope: null,
      }),
    ).toBe(11);
  });

  it('標準係数の scope が scope3 のときだけ energyType からカテゴリを引く', () => {
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'energy', energyType: 'waste' },
        appliedFactorScope: 'scope3',
      }),
    ).toBe(5);
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'energy', energyType: 'business_travel' },
        appliedFactorScope: 'scope3',
      }),
    ).toBe(6);
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'energy', energyType: 'business_travel_commuting' },
        appliedFactorScope: 'scope3',
      }),
    ).toBe(7);
  });

  it('Scope1/2 の係数・係数未確定（読込中）は null（判定しない）', () => {
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'energy', energyType: 'electricity' },
        appliedFactorScope: 'scope2',
      }),
    ).toBeNull();
    // 廃棄物にカスタムの scope1 係数を当てた場合は emission_results に categoryId が付かない。
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'energy', energyType: 'waste' },
        appliedFactorScope: 'scope1',
      }),
    ).toBeNull();
    expect(
      scope3AdoptedCategoryId({
        category: { kind: 'energy', energyType: 'waste' },
        appliedFactorScope: null,
      }),
    ).toBeNull();
  });
});

describe('scope3DirectMethodNoticeText', () => {
  it('方式が direct のときだけ、カテゴリ名と切替の導線を含む注記を返す', () => {
    const text = scope3DirectMethodNoticeText({ categoryId: 5, method: 'direct' });
    expect(text).toContain('カテゴリ5「事業から出る廃棄物」');
    expect(text).toContain('反映されません');
    expect(text).toContain('積上げに切替');
  });

  it('年度ラベルを渡すと、どの年度の方式かを注記に含める', () => {
    const text = scope3DirectMethodNoticeText({
      categoryId: 5,
      method: 'direct',
      fiscalYearLabel: '2025年度',
    });
    // 方式はカテゴリ×年度で持つため、対象年月が属する年度を注記と切替の指示の両方に出す。
    expect(text).toContain('この入力は2025年度の Scope 3 カテゴリ5');
    expect(text).toContain('この年度のこのカテゴリの算定方法');
    expect(text).toContain('Scope分析画面で2025年度のカテゴリ5 を「積上げに切替」');
  });

  it('年度が特定できないときは年度に触れない文面にする', () => {
    const text = scope3DirectMethodNoticeText({ categoryId: 5, method: 'direct', fiscalYearLabel: null });
    expect(text).toContain('この入力は Scope 3 カテゴリ5');
    expect(text).not.toContain('年度');
  });

  it('calculated・方式未取得・対象外カテゴリでは注記を出さない', () => {
    expect(scope3DirectMethodNoticeText({ categoryId: 5, method: 'calculated' })).toBeNull();
    expect(scope3DirectMethodNoticeText({ categoryId: 5, method: null })).toBeNull();
    expect(scope3DirectMethodNoticeText({ categoryId: null, method: 'direct' })).toBeNull();
  });
});

describe('scope3MethodKey', () => {
  it('会計年度IDとカテゴリ番号を 1 つのキーへまとめる', () => {
    expect(scope3MethodKey('fy-2024', 7)).toBe('fy-2024:7');
  });
});
