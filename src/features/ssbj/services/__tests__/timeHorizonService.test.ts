import { afterEach, describe, expect, it, vi } from 'vitest';
import { fictionalTimeHorizonDefinitions } from '../../__fixtures__/fictionalReport';
import { EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS } from '../../utils/timeHorizons';
import {
  getSsbjTimeHorizons,
  toSsbjTimeHorizonColumns,
  toSsbjTimeHorizonDefinitions,
} from '../timeHorizonService';

// DB 行 ⇔ 画面の型の変換と、行が無いレポートの扱いを検証する（RLS・制約はマイグレーション側で確認する）。
const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

afterEach(() => {
  maybeSingle.mockReset();
});

describe('toSsbjTimeHorizonDefinitions / toSsbjTimeHorizonColumns', () => {
  it('列へ分解して戻すと同じになる（状態と値の対が崩れない）', () => {
    expect(toSsbjTimeHorizonDefinitions(toSsbjTimeHorizonColumns(fictionalTimeHorizonDefinitions))).toEqual(
      fictionalTimeHorizonDefinitions,
    );
  });

  it('入力済み以外の欄は値の列を null にする', () => {
    expect(toSsbjTimeHorizonColumns(fictionalTimeHorizonDefinitions)).toMatchObject({
      planningHorizonRelationState: 'unconfirmed',
      planningHorizonRelation: null,
    });
  });

  it('状態と値が食い違う行は補正せず例外にする', () => {
    const row = { ...toSsbjTimeHorizonColumns(fictionalTimeHorizonDefinitions), planningHorizonRelation: '値' };
    expect(() => toSsbjTimeHorizonDefinitions(row)).toThrow();
  });
});

describe('getSsbjTimeHorizons', () => {
  it('まだ保存していないレポートはすべて未入力の定義を返す（0 件を欠落扱いにしない）', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getSsbjTimeHorizons('5b1f0000-0000-4000-8000-000000000003')).resolves.toEqual(
      EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS,
    );
  });

  it('取得エラーは例外にする', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '500', message: 'boom' } });
    await expect(getSsbjTimeHorizons('5b1f0000-0000-4000-8000-000000000003')).rejects.toThrow(
      '時間軸の定義の取得に失敗しました',
    );
  });
});
