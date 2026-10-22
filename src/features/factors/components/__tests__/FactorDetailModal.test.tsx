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
  it('カスタム係数では値の変更履歴を新しい順に「変更前 → 変更後」で表示する', () => {
    const { container, unmount } = render(
      <FactorDetailModal
        factor={factor({ isCustom: true, source: '自社設定' })}
        onClose={() => {}}
        revisions={[
          {
            id: 'r2',
            previousFactorValue: 0.0004,
            previousUnit: 't-CO2/kWh',
            newFactorValue: 0.00038,
            newUnit: 't-CO2/kWh',
            changedAt: '2026-10-19T03:00:00Z',
          },
          {
            id: 'r1',
            previousFactorValue: 0.00045,
            previousUnit: 't-CO2/kWh',
            newFactorValue: 0.0004,
            newUnit: 't-CO2/kWh',
            changedAt: '2026-06-01T03:00:00Z',
          },
        ]}
      />,
    );

    const items = Array.from(container.querySelectorAll('li')).map((item) => item.textContent);
    expect(items).toEqual([
      '2026/10/19 0.000400 t-CO2/kWh → 0.000380 t-CO2/kWh',
      '2026/06/01 0.000450 t-CO2/kWh → 0.000400 t-CO2/kWh',
    ]);
    unmount();
  });

  it('カスタム係数で履歴が無ければその旨を、取得中・失敗はそれぞれの表示を出す', () => {
    const custom = factor({ isCustom: true, source: '自社設定' });
    const empty = render(<FactorDetailModal factor={custom} onClose={() => {}} revisions={[]} />);
    expect(valueOf(empty.container, '値の変更履歴')).toBe('値の変更はありません');
    empty.unmount();

    const loading = render(<FactorDetailModal factor={custom} onClose={() => {}} revisions={null} />);
    expect(valueOf(loading.container, '値の変更履歴')).toBe('読み込み中…');
    loading.unmount();

    const failed = render(
      <FactorDetailModal factor={custom} onClose={() => {}} revisions={null} revisionsLoadFailed />,
    );
    expect(valueOf(failed.container, '値の変更履歴')).toBe('変更履歴の取得に失敗しました');
    failed.unmount();
  });

  it('公式係数には値の変更履歴の欄を出さない', () => {
    const { container, unmount } = render(<FactorDetailModal factor={factor()} onClose={() => {}} />);
    expect(valueOf(container, '値の変更履歴')).toBeNull();
    unmount();
  });
});
