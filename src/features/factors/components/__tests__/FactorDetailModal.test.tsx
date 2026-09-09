// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import type { EmissionFactor } from '../../services/factorService';
import { FactorDetailModal } from '../FactorDetailModal';

// 廃止済みの「地域 / 電力会社」ではなく、事業者別係数の区別を担う
// 供給事業者・メニュー・係数種別を詳細モーダルに表示することを検証する。

const factor = (overrides: Partial<EmissionFactor> = {}): EmissionFactor => ({
  id: 'f1',
  name: '電気 イーレックス(株)（調整後）',
  energyType: '電気',
  scope: 'Scope 2',
  factorValue: 0.000434,
  unit: 't-CO2/kWh',
  applicableYear: 2024,
  region: '全国',
  source: '環境省',
  status: '有効',
  isCustom: false,
  ...overrides,
});

/** ラベル名から Row の値テキストを取り出す。 */
const valueOf = (container: HTMLElement, label: string): string | null => {
  const labelEl = Array.from(container.querySelectorAll('span')).find((el) => el.textContent === label);
  return labelEl?.nextElementSibling?.textContent ?? null;
};

describe('FactorDetailModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('事業者別係数では供給事業者・メニュー・係数種別を表示し、廃止済みの地域ラベルを出さない', () => {
    const { container, unmount } = render(
      <FactorDetailModal
        factor={factor({ providerName: 'イーレックス(株)', menuName: '標準メニュー', factorType: '調整後' })}
        onClose={() => {}}
      />,
    );

    expect(valueOf(container, '供給事業者')).toBe('イーレックス(株)');
    expect(valueOf(container, 'メニュー')).toBe('標準メニュー');
    expect(valueOf(container, '係数種別')).toBe('調整後');
    expect(container.textContent).not.toContain('地域 / 電力会社');
    expect(container.textContent).not.toContain('全国');

    unmount();
  });

  it('事業者に紐づかない係数では供給事業者・メニュー・係数種別を「—」で表示する', () => {
    const { container, unmount } = render(
      <FactorDetailModal factor={factor({ name: '自社係数', isCustom: true })} onClose={() => {}} />,
    );

    expect(valueOf(container, '供給事業者')).toBe('—');
    expect(valueOf(container, 'メニュー')).toBe('—');
    expect(valueOf(container, '係数種別')).toBe('—');

    unmount();
  });
});
