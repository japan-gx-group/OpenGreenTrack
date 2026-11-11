// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { REGIONS } from '@/types/region';
import { LocationTypeChart } from '../LocationTypeChart.client';
import type { LocationRecord } from '../../types';

// 拠点種別構成のドーナツは、recharts のマウント時アニメーションが途中で止まり、
// 弧が欠けたまま表示されることがある（ホバー等の再レンダリングのたびに再発する）。
// そのため Pie はアニメーションを無効にして、最初から全周を描く必要がある。
// jsdom では ResponsiveContainer がサイズを持たず SVG が描かれないので、
// Pie に渡された props を記録して検証する。
const pieProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Pie: (props: Record<string, unknown>) => {
      pieProps.current = props;
      return null;
    },
  };
});

const ROW: LocationRecord = {
  id: 'loc-1',
  name: '本社拠点',
  region: REGIONS[0],
  type: 'headquarters',
  person: '山田',
  status: 'active',
};

describe('LocationTypeChart', () => {
  let rendered: RenderResult | null = null;

  afterEach(() => {
    rendered?.unmount();
    rendered = null;
    pieProps.current = null;
  });

  it('ドーナツのアニメーションを無効化して初回から全周を描画する', () => {
    rendered = render(<LocationTypeChart database={[ROW]} />);

    expect(pieProps.current).not.toBeNull();
    expect(pieProps.current?.isAnimationActive).toBe(false);
  });
});
