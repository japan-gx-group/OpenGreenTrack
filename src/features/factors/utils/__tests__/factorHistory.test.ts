import { describe, expect, it } from 'vitest';
import type { EmissionFactor } from '../../services/factorService';
import { selectFactorHistory } from '../factorHistory';

const factor = (overrides: Partial<EmissionFactor> & Pick<EmissionFactor, 'id'>): EmissionFactor => ({
  name: overrides.id,
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.1,
  unit: 't-CO2/kWh',
  applicableYear: 2025,
  region: '全国',
  source: '環境省',
  status: '有効',
  isCustom: false,
  ...overrides,
});

describe('selectFactorHistory', () => {
  it('カスタム係数だけを更新日時の新しい順に返す', () => {
    const history = selectFactorHistory([
      factor({ id: 'custom-old', isCustom: true, updatedAt: '2026-01-01T00:00:00Z' }),
      factor({ id: 'custom-new', isCustom: true, updatedAt: '2026-03-01T00:00:00Z' }),
      factor({ id: 'custom-mid', isCustom: true, updatedAt: '2026-02-01T00:00:00Z' }),
    ]);

    expect(history.map((item) => item.id)).toEqual(['custom-new', 'custom-mid', 'custom-old']);
  });

  it('公式係数はシード一括投入で同着になるため、更新日時があっても履歴に含めない', () => {
    const history = selectFactorHistory([
      factor({ id: 'official-1', updatedAt: '2026-09-01T00:00:00Z' }),
      factor({ id: 'official-2', updatedAt: '2026-09-01T00:00:00Z' }),
      factor({ id: 'custom', isCustom: true, updatedAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(history.map((item) => item.id)).toEqual(['custom']);
  });

  it('更新日時を持たないカスタム係数は除外する', () => {
    const history = selectFactorHistory([
      factor({ id: 'no-date', isCustom: true }),
      factor({ id: 'dated', isCustom: true, updatedAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(history.map((item) => item.id)).toEqual(['dated']);
  });

  it('入力配列を破壊しない', () => {
    const input = [
      factor({ id: 'a', isCustom: true, updatedAt: '2026-01-01T00:00:00Z' }),
      factor({ id: 'b', isCustom: true, updatedAt: '2026-02-01T00:00:00Z' }),
    ];

    selectFactorHistory(input);

    expect(input.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
