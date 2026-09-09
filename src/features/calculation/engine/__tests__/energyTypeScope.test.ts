import { describe, expect, it } from 'vitest';
import { ENERGY_TYPES } from '../../types';
import { SCOPE_BY_ENERGY_TYPE, scopeForEnergyType, scopeForEnergyTypeName } from '../energyTypeScope';
import { scope3CategoryIdForEnergyType } from '../scope3Category';

describe('SCOPE_BY_ENERGY_TYPE', () => {
  it('EnergyType の全値に Scope がある', () => {
    for (const energyType of ENERGY_TYPES) {
      expect(SCOPE_BY_ENERGY_TYPE[energyType]).toBeDefined();
    }
  });

  it('Scope3 の種別は IDEA 積上げを除きカテゴリ番号を持つ', () => {
    // カテゴリ番号が無い Scope3 の算定結果は refresh_dashboard_aggregates
    // （categoryId が 1〜15 の行だけを積む）に載らず、排出量が黙って落ちる。
    for (const energyType of ENERGY_TYPES) {
      if (SCOPE_BY_ENERGY_TYPE[energyType] !== 'scope3' || energyType === 'scope3_activity') continue;
      expect(scope3CategoryIdForEnergyType(energyType)).not.toBeNull();
    }
  });

  it('Scope1・2 の種別はカテゴリ番号を持たない', () => {
    for (const energyType of ENERGY_TYPES) {
      if (SCOPE_BY_ENERGY_TYPE[energyType] === 'scope3') continue;
      expect(scope3CategoryIdForEnergyType(energyType)).toBeNull();
    }
  });

  it('公式係数 seed と同じ Scope を返す', () => {
    expect(scopeForEnergyType('electricity')).toBe('scope2');
    expect(scopeForEnergyType('heat')).toBe('scope2');
    expect(scopeForEnergyType('city_gas')).toBe('scope1');
    expect(scopeForEnergyType('fuel_diesel')).toBe('scope1');
    expect(scopeForEnergyType('waste')).toBe('scope3');
    expect(scopeForEnergyType('business_travel')).toBe('scope3');
  });

  it('公式係数が無い種別も一意に決まる', () => {
    // 上水道の購入はカテゴリ1（購入した製品・サービス）。自社保有車の燃料は Scope1。
    expect(scopeForEnergyType('water')).toBe('scope3');
    expect(scope3CategoryIdForEnergyType('water')).toBe(1);
    expect(scopeForEnergyType('vehicle')).toBe('scope1');
    expect(scopeForEnergyType('scope3_activity')).toBe('scope3');
  });
});

describe('scopeForEnergyTypeName', () => {
  it('未知の種別は null（Object.prototype 由来の名前も拾わない）', () => {
    expect(scopeForEnergyTypeName('electricity')).toBe('scope2');
    expect(scopeForEnergyTypeName('unknown_type')).toBeNull();
    expect(scopeForEnergyTypeName('constructor')).toBeNull();
    expect(scopeForEnergyTypeName('toString')).toBeNull();
  });
});
