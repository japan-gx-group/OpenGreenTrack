import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fictionalRisksOpportunities } from '../../__fixtures__/fictionalReport';
import { SSBJ_EDIT_CONFLICT_MESSAGE, SSBJ_FORBIDDEN_MESSAGE, SsbjEditConflictError } from '../../utils/writeError';
import {
  deleteSsbjRiskOpportunity,
  toSsbjRiskOpportunity,
  toSsbjRiskOpportunityColumns,
  toSsbjRiskOpportunityWorkingRecord,
  updateSsbjRiskOpportunity,
  type SsbjRiskOpportunityRow,
} from '../riskOpportunityService';

// DB 行 ⇔ 画面の型の変換と、更新の競合検知を検証する（RLS・制約はマイグレーション側で確認する）。
// 更新は、eq の条件に合う行だけを書き換える小さな DB（db.rows）で動かし、2 つの画面からの保存を再現する。
// 更新のたびに updatedAt を進めるのは DB のトリガー（set_updated_at）で、ここではその動きを真似る。
// db.canEdit が false の間は、RLS の RESTRICTIVE のポリシーと同じく、更新・削除をエラーにせず 0 件にする（読むことはできる）。
type Query = { update: Record<string, unknown> | null; filters: [string, unknown][] };
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], clock: 0, canEdit: true }));
const matches = (filters: Query['filters']) => (candidate: Record<string, unknown>) =>
  filters.every(([column, value]) => candidate[column] === value);
const runQuery = async ({ update, filters }: Query) => {
  const row = db.rows.find(matches(filters));
  if (!row || (update && !db.canEdit)) return { data: null, error: null };
  if (update) {
    db.clock += 1;
    Object.assign(row, update, { updatedAt: `2026-10-09T00:00:00.${String(db.clock).padStart(6, '0')}+00:00` });
  }
  return { data: { ...row }, error: null };
};
const runDelete = async ({ filters }: Query) => {
  const index = db.canEdit ? db.rows.findIndex(matches(filters)) : -1;
  if (index < 0) return { data: [], error: null };
  const [row] = db.rows.splice(index, 1);
  return { data: [{ id: row.id }], error: null };
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
        delete: () => ({
          eq: (column: string, value: unknown) => ({
            select: () => runDelete({ ...query, filters: [...query.filters, [column, value]] }),
          }),
        }),
      };
      return builder;
    },
    rpc: async (name: string) => (name === 'ssbj_current_user_can_edit'
      ? { data: db.canEdit, error: null }
      : { data: null, error: { message: 'unexpected rpc' } }),
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
    db.canEdit = true;
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

  it('画面を開いた後にロールが変わって編集できなくなったら、競合ではなく権限のメッセージにする（行は変えない）', async () => {
    db.canEdit = false;
    const stale = updateSsbjRiskOpportunity(loadedFirst, { ...inputOf(loadedFirst), title: 'A の名称' });
    await expect(stale).rejects.toThrow(SSBJ_FORBIDDEN_MESSAGE);
    await expect(stale).rejects.not.toBeInstanceOf(SsbjEditConflictError);
    expect(db.rows[0]).toMatchObject({ title: first.title });
  });
});

describe('deleteSsbjRiskOpportunity', () => {
  const [first] = fictionalRisksOpportunities;

  beforeEach(() => {
    db.canEdit = true;
    db.rows = [{ ...rowOf(first), updatedAt: '2026-10-01T00:00:00.000001+00:00' }];
  });

  it('行を削除する', async () => {
    await expect(deleteSsbjRiskOpportunity(first.id)).resolves.toBeUndefined();
    expect(db.rows).toEqual([]);
  });

  it('ロールが変わって編集できなくなったら（0 件）、成功にせず権限のメッセージにする', async () => {
    db.canEdit = false;
    await expect(deleteSsbjRiskOpportunity(first.id)).rejects.toThrow(SSBJ_FORBIDDEN_MESSAGE);
    expect(db.rows).toHaveLength(1);
  });

  it('削除済みの行（0 件）は成功にせず、開き直しを促す', async () => {
    db.rows = [];
    await expect(deleteSsbjRiskOpportunity(first.id)).rejects.toThrow('リスク・機会が見つかりません。画面を開き直してください');
  });
});
