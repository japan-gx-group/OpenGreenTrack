// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, focusElement, render } from '@/lib/testing/render';
import { TopLocationsTable } from '../TopLocationsTable.client';
import type { DashboardTopLocationDetail } from '../../services/dashboardService';

// 排出量上位拠点テーブルの操作性テスト。
// 行クリックだけでなくキーボード・スクリーンリーダーからも拠点絞り込みへ到達できることを守る。
// あわせて前年比列が「色による良し悪しの断定は年度終了後だけ」を守っていることも検証する。

const rows: DashboardTopLocationDetail[] = [
  {
    locationId: 'loc-1',
    name: '東京本社',
    region: 'kanto',
    type: 'office',
    scope1: 12.5,
    scope2: 30,
    total: 42.5,
    diffPercent: -3.2,
  },
  {
    locationId: 'loc-2',
    name: '大阪工場',
    region: 'kinki',
    type: 'factory',
    scope1: 80,
    scope2: 20,
    total: 100,
    diffPercent: null,
  },
];

const renderTable = (
  selectedLocationId: string | null,
  onSelectLocation = vi.fn(),
  fiscalYearEnded = true,
) => {
  const result = render(
    <TopLocationsTable
      rows={rows}
      fiscalYearLabel="2026年度"
      fiscalYearEnded={fiscalYearEnded}
      selectedLocationId={selectedLocationId}
      onSelectLocation={onSelectLocation}
      emptyMessage="データなし"
    />,
  );
  return { ...result, onSelectLocation };
};

describe('TopLocationsTable', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('各行の拠点名がキーボードで到達できる実ボタンになっている', () => {
    const { container, unmount } = renderTable(null);

    const buttons = container.querySelectorAll<HTMLButtonElement>('tbody button[aria-pressed]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toContain('東京本社');
    expect(buttons[0].getAttribute('type')).toBe('button');

    // Tab で辿れる（tabIndex が負でない）こと、フォーカスを受け取れることを確認する
    expect(buttons[0].tabIndex).toBeGreaterThanOrEqual(0);
    focusElement(buttons[0]);
    expect(document.activeElement).toBe(buttons[0]);

    // 案内文がボタンの説明として結び付いている
    const describedBy = buttons[0].getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('絞り込みます');

    unmount();
  });

  it('ボタンの操作で onSelectLocation が1回だけ呼ばれる（行クリックと二重発火しない）', () => {
    const { container, onSelectLocation, unmount } = renderTable(null);

    const button = container.querySelector<HTMLButtonElement>('tbody button[aria-pressed]')!;
    click(button);

    expect(onSelectLocation).toHaveBeenCalledTimes(1);
    expect(onSelectLocation).toHaveBeenCalledWith('loc-1');
    unmount();
  });

  it('行自体のクリックでも同じ拠点で絞り込める', () => {
    const { container, onSelectLocation, unmount } = renderTable(null);

    const secondRow = container.querySelectorAll<HTMLTableRowElement>('tbody tr')[1];
    click(secondRow);

    expect(onSelectLocation).toHaveBeenCalledTimes(1);
    expect(onSelectLocation).toHaveBeenCalledWith('loc-2');
    unmount();
  });

  it('選択中の行は aria-pressed=true になり、再操作で絞り込みが解除される', () => {
    const { container, onSelectLocation, unmount } = renderTable('loc-2');

    const buttons = container.querySelectorAll<HTMLButtonElement>('tbody button[aria-pressed]');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');

    click(buttons[1]);
    expect(onSelectLocation).toHaveBeenCalledTimes(1);
    expect(onSelectLocation).toHaveBeenCalledWith(null);
    unmount();
  });

  it('行末のアイコンは遷移を示す矢印ではなく、装飾として読み上げ対象外になっている', () => {
    const { container, unmount } = renderTable(null);

    const icons = container.querySelectorAll('tbody svg.gt-row-filter-icon');
    expect(icons).toHaveLength(2);
    icons.forEach(icon => expect(icon.getAttribute('aria-hidden')).toBe('true'));
    expect(container.querySelector('tbody svg.gt-row-arrow')).toBeNull();
    unmount();
  });

  // 分子＝表示年度の期中累計・分母＝前年度の通年実績のため、年度が終わるまでは
  // 実態より大きな「削減」に見える。期中は増減率を出しつつ評価色を付けない。
  it('年度終了後は前年比に評価色を付ける', () => {
    const { container, unmount } = renderTable(null, vi.fn(), true);

    const pill = container.querySelector<HTMLElement>('tbody tr .gt-pill')!;
    expect(pill.className).toContain('gt-pill-good');
    expect(pill.textContent).toBe('↓3.2%');
    unmount();
  });

  it('期中は前年比を「（期中）」付きの中立色にする', () => {
    const { container, unmount } = renderTable(null, vi.fn(), false);

    const pill = container.querySelector<HTMLElement>('tbody tr .gt-pill')!;
    expect(pill.className).toContain('gt-pill-neutral');
    expect(pill.className).not.toContain('gt-pill-good');
    expect(pill.textContent).toBe('↓3.2%（期中）');

    // 前年度のデータが無い行は比較そのものが無いので「（期中）」を付けない。
    const pills = container.querySelectorAll<HTMLElement>('tbody tr .gt-pill');
    expect(pills[1].textContent).toBe('前年比データなし');
    unmount();
  });

  it('0件のときは空メッセージだけを表示する', () => {
    const { container, unmount } = render(
      <TopLocationsTable
        rows={[]}
        fiscalYearLabel="2026年度"
        fiscalYearEnded
        selectedLocationId={null}
        onSelectLocation={() => {}}
        emptyMessage="拠点別の排出量データはまだ登録されていません。"
      />,
    );

    expect(container.querySelector('.gt-table-empty')?.textContent).toBe(
      '拠点別の排出量データはまだ登録されていません。',
    );
    expect(container.querySelector('tbody button')).toBeNull();
    unmount();
  });
});
