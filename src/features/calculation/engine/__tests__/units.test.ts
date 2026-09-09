import { describe, expect, it } from 'vitest';
import { resolveUnitConversion } from '../units';

describe('resolveUnitConversion', () => {
  it('同一単位・分子t-CO2e は換算係数 1', () => {
    expect(resolveUnitConversion('kWh', 't-CO2e/kWh')).toBe(1);
  });

  it('表記ゆらぎ（m³ と m3）を吸収する', () => {
    expect(resolveUnitConversion('m³', 't-CO2e/m3')).toBe(1);
  });

  it('同一次元の分母単位違いを換算する（MWh → kWh は 1000 倍）', () => {
    expect(resolveUnitConversion('MWh', 't-CO2e/kWh')).toBe(1_000);
    expect(resolveUnitConversion('kL', 't-CO2e/L')).toBe(1_000);
  });

  it('分子が kg-CO2e の係数は t-CO2e へ 0.001 倍で揃える（1000倍バグを防ぐ）', () => {
    expect(resolveUnitConversion('kWh', 'kg-CO2e/kWh')).toBe(0.001);
    // 分母換算と分子換算が合成される: MWh→kWh(1000) × kg→t(0.001) = 1
    expect(resolveUnitConversion('MWh', 'kg-CO2e/kWh')).toBe(1);
  });

  it('質量次元（t-CO2e/t）を kg 実績と換算する（kg → t は 0.001 倍）', () => {
    expect(resolveUnitConversion('t', 't-CO2e/t')).toBe(1);
    expect(resolveUnitConversion('kg', 't-CO2e/t')).toBe(0.001);
  });

  it('ガス事業者別係数（t-CO2/千m3）を m3 実績と換算する（m3 → 千m3 は 0.001 倍）', () => {
    expect(resolveUnitConversion('m3', 't-CO2/千m3')).toBe(0.001);
    expect(resolveUnitConversion('m³', 't-CO2/千m3')).toBe(0.001);
  });

  it('熱供給事業者別係数（t-CO2/GJ）を GJ / MJ 実績と換算する', () => {
    expect(resolveUnitConversion('GJ', 't-CO2/GJ')).toBe(1);
    expect(resolveUnitConversion('MJ', 't-CO2/GJ')).toBe(0.001);
  });

  it('分子の CO2 表記（tCO2 / t-CO2）を CO2e 1:1 として扱う', () => {
    expect(resolveUnitConversion('kWh', 't-CO2/kWh')).toBe(1);
    expect(resolveUnitConversion('t', 'tCO2/t')).toBe(1);
    expect(resolveUnitConversion('L', 'tCO2/kl')).toBe(0.001); // kl 表記ゆらぎ + kL→L
  });

  it('電気（kWh）と熱（GJ）は次元を分けて誤マッチさせない', () => {
    expect(resolveUnitConversion('kWh', 't-CO2/GJ')).toBeNull();
    expect(resolveUnitConversion('GJ', 't-CO2e/kWh')).toBeNull();
  });

  it('次元が異なる分母の組み合わせは null（UNIT_MISMATCH）', () => {
    expect(resolveUnitConversion('kWh', 't-CO2e/m3')).toBeNull();
    expect(resolveUnitConversion('L', 't-CO2e/kWh')).toBeNull();
  });

  it('分子が CO2e 系でない係数は null（UNIT_MISMATCH）', () => {
    expect(resolveUnitConversion('kWh', 'JPY/kWh')).toBeNull();
  });

  it('未知の単位や係数側が単位形式でない場合は null', () => {
    expect(resolveUnitConversion('個', 't-CO2e/kWh')).toBeNull();
    expect(resolveUnitConversion('kWh', 't-CO2e')).toBeNull();
  });
});
