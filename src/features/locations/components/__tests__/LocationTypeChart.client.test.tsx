// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { REGIONS } from '@/types/region';
import { LocationTypeChart } from '../LocationTypeChart.client';
import type { LocationRecord } from '../../types';

// マウント時アニメーションが途中で止まり弧が欠けるため（#129）、
// ドーナツは isAnimationActive={false} で即座に全周を描画する必要がある。
// jsdom ではサイズを持たないため、Pie に渡された props を記録して検証する。
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
  it('ドーナツのアニメーションを無効化して初回から全周を描画する', () => {
    pieProps.current = null as Record<string, unknown> | null;
    render(<LocationTypeChart database={[ROW]} />);

    expect(pieProps.current).not.toBeNull();
    expect(pieProps.current?.isAnimationActive).toBe(false);
  });
});
