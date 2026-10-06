// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@/lib/testing/render';
import { Scope2BasisCard } from '../Scope2BasisCard';

// Scope 2 基準別カードは「0」と「未算定」を厳密に区別する。
// 未算定（null）を 0 や部分合計として見せると、根拠の無い値が基準別の報告値として
// 読まれてしまうため、数値の代わりに「—」と案内文を出す。

describe('Scope2BasisCard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('両基準の値と、マーケット基準の契約根拠・補完の内訳を表示する', () => {
    const { container } = render(
      <Scope2BasisCard
        totals={{ locationBased: 1.248, marketBased: 0.9, marketContract: 0.3 }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('ロケーション基準');
    expect(text).toContain('マーケット基準');
    expect(text).toContain('1.248');
    expect(text).toContain('0.9');
    // 補完分 = marketBased - marketContract
    expect(text).toContain('契約メニュー根拠 0.3');
    expect(text).toContain('代替値補完 0.6');
    expect(text).not.toContain('未算定');
  });

  it('未算定（null）は 0 ではなく「—」と案内文で表示する', () => {
    const { container } = render(
      <Scope2BasisCard totals={{ locationBased: null, marketBased: null, marketContract: null }} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('—');
    expect(text).toContain('未算定');
    expect(text).toContain('「排出量を算定」を実行すると表示されます');
  });

  it('0 は値として表示する（未算定とは区別する）', () => {
    const { container } = render(
      <Scope2BasisCard totals={{ locationBased: 0, marketBased: 0, marketContract: 0 }} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('未算定');
    expect(text).not.toContain('—');
  });
});
