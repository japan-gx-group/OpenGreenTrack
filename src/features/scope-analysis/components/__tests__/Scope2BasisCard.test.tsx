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
    // 両基準そろっていれば未算定の原因の案内は出さない
    expect(text).not.toContain('基準別の値は、排出量の算定時に');
  });

  it('未算定（null）は 0 ではなく「—」と案内文で表示する', () => {
    const { container } = render(
      <Scope2BasisCard
        totals={{ locationBased: null, marketBased: null, marketContract: null }}
        coverage={{ scope2RecordCount: 0, locationBasedCount: 0, marketBasedCount: 0 }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('—');
    expect(text).toContain('未算定');
    expect(text).toContain('この年度の Scope 2 の算定結果がまだありません');
    // 画面に無いボタン名で案内しない（算定は保存時の自動算定で走る）
    expect(text).not.toContain('「排出量を算定」');
    expect(text).toContain('データ入力画面でこの年度の活動量を保存すると、その年度の算定が自動で実行されます');
  });

  it('一部のデータだけ基準別の値がある場合は件数を示し、算定できない原因と通知の場所を案内する', () => {
    const { container } = render(
      <Scope2BasisCard
        totals={{ locationBased: null, marketBased: null, marketContract: null }}
        coverage={{ scope2RecordCount: 12, locationBasedCount: 10, marketBasedCount: 9 }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Scope 2 の算定済みデータ 12 件のうち、この基準の値があるのは 10 件です');
    expect(text).toContain('Scope 2 の算定済みデータ 12 件のうち、この基準の値があるのは 9 件です');
    expect(text).toContain('対象年度に全国の代替値（公式の標準係数）が無いか');
    expect(text).toContain('算定完了時の通知に件数と理由が表示されます');
  });

  it('明細がそろっているのに集計が未更新なら、次回の算定で更新されると案内する', () => {
    const { container } = render(
      <Scope2BasisCard
        totals={{ locationBased: null, marketBased: 0.9, marketContract: 0 }}
        coverage={{ scope2RecordCount: 3, locationBasedCount: 3, marketBasedCount: 3 }}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('すべての Scope 2 データにこの基準の値があります');
    expect(text).not.toContain('件のうち');
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
