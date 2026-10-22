import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fictionalRisksOpportunities } from '../../__fixtures__/fictionalReport';
import { SSBJ_EDIT_CONFLICT_MESSAGE, SsbjEditConflictError } from '../../utils/writeError';
import {
  toSsbjRiskOpportunity,
  toSsbjRiskOpportunityColumns,
  toSsbjRiskOpportunityWorkingRecord,
  updateSsbjRiskOpportunity,
  type SsbjRiskOpportunityRow,
} from '../riskOpportunityService';

// DB 行 ⇔ 画面の型の変換と、更新の競合検知を検証する（RLS・制約はマイグレーション側で確認する）。
// 更新は、eq の条件に合う行だけを書き換える小さな DB（db.rows）で動かし、2 つの画面からの保存を再現する。
// 更新のたびに updatedAt を進めるのは DB のトリガー（set_updated_at）で、ここではその動きを真似る。
type Query = { update: Record<string, unknown> | null; filters: [string, unknown][] };
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], clock: 0 }));
const runQuery = async ({ update, filters }: Query) => {
  const row = db.rows.find(candidate => filters.every(([column, value]) => candidate[column] === value));
  if (!row) return { data: null, error: null };
  if (update) {
    db.clock += 1;
    Object.assign(row, update, { updatedAt: `2026-10-09T00:00:00.${String(db.clock).padStart(6, '0')}+00:00` });
  }
  return { data: { ...row }, error: null };
};
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      const query: Query = { update: null, filters: [] };
      const builder = {
        select: () => builder,
        update: (columns: Record<string, unknown>) => {
          query.update = columns;
          return builder;
        },
        eq: (column: string, value: unknown) => {
          query.filters.push([column, value]);
          return builder;
        },
        maybeSingle: () => runQuery(query),
      };
      return builder;
    },
  }),
}));

const rowOf = (item: (typeof fictionalRisksOpportunities)[number]): SsbjRiskOpportunityRow => ({
  id: item.id,
  ...toSsbjRiskOpportunityColumns(item),
});

describe('toSsbjRiskOpportunity / toSsbjRiskOpportunityColumns', () => {
  it('架空データは列へ分解して戻すと同じになる（状態と値の対が崩れない）', () => {
    for (const item of fictionalRisksOpportunities) {
      expect(toSsbjRiskOpportunity(rowOf(item))).toEqual(item);
    }
  });

  it('入力済み以外の説明・時間軸は値の列を null にする', () => {
    const columns = toSsbjRiskOpportunityColumns(fictionalRisksOpportunities[2]);
    expect(columns).toMatchObject({
      descriptionState: 'unanswered',
      descriptionText: null,
      timeHorizonState: 'unanswered',
      timeHorizon: null,
    });
  });

  it('状態と値が食い違う行は補正せず例外にする', () => {
    const row = { ...rowOf(fictionalRisksOpportunities[2]), descriptionText: '値があるのに未入力' };
    expect(() => toSsbjRiskOpportunity(row)).toThrow();
  });

  it('不明な区分は例外にする', () => {
    expect(() => toSsbjRiskOpportunity({ ...rowOf(fictionalRisksOpportunities[0]), kind: 'threat' })).toThrow(
      '不明なリスク・機会の区分です',
    );
  });

  it('編集画面用のレコードには更新日時を添え、保存版と同じ形の部分は変えない', () => {
    const item = fictionalRisksOpportunities[0];
    const updatedAt = '2026-10-09T01:02:03.123456+00:00';
    expect(toSsbjRiskOpportunityWorkingRecord({ ...rowOf(item), updatedAt })).toEqual({ ...item, updatedAt });
  });
});

describe('updateSsbjRiskOpportunity（2 つの画面からの保存）', () => {
  const LOADED_AT = '2026-10-01T00:00:00.000001+00:00';
  const [first, second] = fictionalRisksOpportunities;
  // 画面 A・B が同じ時点で一覧を開いている。
  const loadedFirst = toSsbjRiskOpportunityWorkingRecord({ ...rowOf(first), updatedAt: LOADED_AT });
  const loadedSecond = toSsbjRiskOpportunityWorkingRecord({ ...rowOf(second), updatedAt: LOADED_AT });
  const inputOf = (item: typeof loadedFirst) => ({
    kind: item.kind,
    title: item.title,
    riskType: item.riskType,
    description: item.description,
    timeHorizon: item.timeHorizon,
    linkTargets: item.linkTargets,
  });

  beforeEach(() => {
    db.clock = 0;
    db.rows = [
      { ...rowOf(first), updatedAt: LOADED_AT },
      { ...rowOf(second), updatedAt: LOADED_AT },
    ];
  });

  it('読込時の更新日時を条件に含めて更新し、新しい更新日時を返す', async () => {
    const saved = await updateSsbjRiskOpportunity(loadedFirst, { ...inputOf(loadedFirst), title: 'A の名称' });
    expect(saved).toMatchObject({ id: first.id, title: 'A の名称' });
    expect(saved.updatedAt).not.toBe(LOADED_AT);
  });

  it('先に別の画面が同じ行を保存していたら、古い画面の保存を競合として拒否し、先の変更を残す', async () => {
    await updateSsbjRiskOpportunity(loadedFirst, { ...inputOf(loadedFirst), title: 'A の名称' });

    // 画面 B は再読込せずに説明の内部メモだけを変えて保存する（名称は読込時の古い値のまま送られる）。
    const stale = updateSsbjRiskOpportunity(loadedFirst, {
      ...inputOf(loadedFirst),
      description: { ...loadedFirst.description, internalNote: 'B のメモ' },
    });
    await expect(stale).rejects.toBeInstanceOf(SsbjEditConflictError);
    await expect(stale).rejects.toThrow(SSBJ_EDIT_CONFLICT_MESSAGE);
    expect(db.rows[0]).toMatchObject({ title: 'A の名称', internalNote: first.description.internalNote });
  });

  it('別の行の変更では競合にしない', async () => {
    await updateSsbjRiskOpportunity(loadedFirst, { ...inputOf(loadedFirst), title: 'A の名称' });
    await expect(
      updateSsbjRiskOpportunity(loadedSecond, { ...inputOf(loadedSecond), title: 'B の名称' }),
    ).resolves.toMatchObject({ id: second.id, title: 'B の名称' });
  });

  it('削除済みの行は競合ではなく「見つかりません」にする', async () => {
    db.rows = db.rows.slice(1);
    await expect(
      updateSsbjRiskOpportunity(loadedFirst, { ...inputOf(loadedFirst), title: 'A の名称' }),
    ).rejects.toThrow('リスク・機会が見つかりません');
  });
});
