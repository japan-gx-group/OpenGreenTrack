// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, render } from '@/lib/testing/render';
import type { EmissionFactor } from '../../services/factorService';
import { FactorHistoryModal } from '../FactorHistoryModal';
import { FACTOR_HISTORY_PAGE_SIZE } from '../../utils/factorHistory';

// 履歴の対象がカスタム係数に限られること、全件を一度に <tr> 化せず段階的に描画することを検証する。

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

const customFactors = (count: number): EmissionFactor[] =>
  Array.from({ length: count }, (_, index) =>
    factor({
      id: `custom-${index}`,
      isCustom: true,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    }),
  );

const bodyRows = (container: HTMLElement): number => container.querySelectorAll('tbody tr').length;

const findMoreButton = (container: HTMLElement): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.startsWith('さらに'));

describe('FactorHistoryModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('公式係数しか無い場合はカスタム係数が無い旨を表示する', () => {
    const { container, unmount } = render(
      <FactorHistoryModal
        factors={[factor({ id: 'official', updatedAt: '2026-09-01T00:00:00Z' })]}
        onClose={() => {}}
      />,
    );

    expect(container.textContent).toContain('追加・変更したカスタム係数はまだありません。');
    expect(container.querySelector('table')).toBeNull();

    unmount();
  });

  it('ページサイズを超える件数は「さらに表示」で段階的に描画する', () => {
    const total = FACTOR_HISTORY_PAGE_SIZE + 5;
    const { container, unmount } = render(
      <FactorHistoryModal factors={customFactors(total)} onClose={() => {}} />,
    );

    expect(bodyRows(container)).toBe(FACTOR_HISTORY_PAGE_SIZE);
    expect(container.textContent).toContain(`カスタム係数 ${total} 件`);
    expect(container.textContent).toContain(`${FACTOR_HISTORY_PAGE_SIZE} 件まで表示中`);

    const more = findMoreButton(container);
    expect(more?.textContent).toContain('さらに 5 件を表示');
    click(more!);

    expect(bodyRows(container)).toBe(total);
    expect(findMoreButton(container)).toBeUndefined();

    unmount();
  });
});
