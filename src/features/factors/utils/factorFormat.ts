import type { EmissionFactor } from '../services/factorService';

export const formatFactorDate = (value?: string): string => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
};

// 係数の単位（"t-CO2e/kWh" 等）から算定式を組み立てる。
// 分子=排出量単位、分母=活動量単位。単位形式でなければ汎用式にフォールバックする。
export const deriveFormula = (factor: Pick<EmissionFactor, 'unit' | 'factorValue'>): string => {
  const parts = factor.unit.split('/');
  const value = factor.factorValue.toFixed(6);
  if (parts.length < 2) {
    return `排出量 = 活動量 × ${value}`;
  }
  const numerator = parts[0].trim();
  const denominator = parts.slice(1).join('/').trim();
  return `排出量 [${numerator}] = 活動量 [${denominator}] × ${value} [${factor.unit}]`;
};
