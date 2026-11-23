import { afterEach, describe, expect, it, vi } from 'vitest';

// 証跡一式（R2-33）の「操作履歴」シートに、選んだ保存版の作成・承認の記録が、後から操作履歴が増えても必ず入ることを検証する。
// ssbj_audit_logs を、PostgREST と同じく 1 リクエスト最大 1,000 件しか返さない偽の DB に置き換える。
type Row = {
  id: number; reportId: string; actorUserId: string | null; action: string; targetType: string;
  targetId: string | null; changedColumns: string[] | null; details: Record<string, unknown>; createdAt: string;
};
const MAX_ROWS = 1000;
const db = vi.hoisted(() => ({ rows: [] as Row[], requests: [] as { from: number; to: number }[] }));

const query = () => {
  const filters: [string, string][] = [];
  let ascending = true;
  let range: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  const valueOf = (row: Row, column: string): unknown => {
    const json = column.match(/^(\w+)->>(\w+)$/);
    if (json) {
      const value = (row[json[1] as keyof Row] as Record<string, unknown> | null)?.[json[2]];
      return value === undefined || value === null ? null : String(value);
    }
    return row[column as keyof Row];
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => { filters.push([column, value]); return builder; },
    order: (_column: string, options: { ascending: boolean }) => { ascending = options.ascending; return builder; },
    range: (from: number, to: number) => { range = [from, to]; db.requests.push({ from, to }); return builder; },
    then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
      const matched = db.rows
        .filter(row => filters.every(([column, value]) => valueOf(row, column) === value))
        .sort((a, b) => (ascending ? a.id - b.id : b.id - a.id));
      const [from, to] = range;
      return Promise.resolve({ data: matched.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null }).then(resolve);
    },
  };
  return builder;
};
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => query() }) }));

import { fictionalSnapshot } from '../../__fixtures__/fictionalReport';
import type { SsbjAuditTrailDetails } from '../../types';
import { listAllSsbjAuditLogs, listSsbjVersionAuditLogs } from '../auditLogService';
import { buildSsbjAuditTrailSheets } from '../auditTrailService';

const REPORT = 'report-1';
const VERSION = 'version-3';
let nextId = 1;
const log = (overrides: Partial<Row>): Row => ({
  id: nextId++, reportId: REPORT, actorUserId: 'user-1', action: 'update', targetType: 'narrative',
  targetId: 'narrative-1', changedColumns: ['body'], details: {}, createdAt: '2025-06-01T00:00:00Z', ...overrides,
});

const emptyTrail: SsbjAuditTrailDetails = { details: [], scope3Direct: [], factors: [] };

afterEach(() => { db.rows = []; db.requests = []; nextId = 1; });

describe('証跡一式の操作履歴', () => {
  it('承認後に同じレポートの操作履歴が 1,000 件以上増えても、選んだ版の作成・承認の記録が入る', async () => {
    db.rows.push(
      log({ action: 'version_create', targetType: 'version', targetId: 'version-2', details: { versionNumber: 2 } }),
      log({ action: 'version_create', targetType: 'version', targetId: VERSION, details: { versionNumber: 3 },
        actorUserId: 'approver-1', createdAt: '2025-06-05T00:00:00Z' }),
      log({ action: 'status_change', targetType: 'report', targetId: REPORT, actorUserId: 'approver-1',
        details: { operation: 'approve', from: 'in_review', to: 'approved', versionId: VERSION, versionNumber: 3 },
        createdAt: '2025-06-05T00:00:00Z' }),
      // 別のレポートの同じ形の記録は入れない。
      log({ reportId: 'report-2', action: 'version_create', targetType: 'version', targetId: VERSION }),
    );
    for (let index = 0; index < 1200; index += 1) {
      db.rows.push(log({ createdAt: '2025-07-01T00:00:00Z' }));
    }

    const versionLogs = await listSsbjVersionAuditLogs(REPORT, VERSION);
    expect(versionLogs.map(item => [item.action, item.targetId])).toEqual([
      ['version_create', VERSION],
      ['status_change', REPORT],
    ]);

    // レポートの操作履歴のすべては 1,000 件ずつ読み、新しい順に並べる（1,203 件）。
    db.requests = [];
    const allLogs = await listAllSsbjAuditLogs(REPORT);
    expect(allLogs).toHaveLength(1203);
    expect(db.requests).toEqual([{ from: 0, to: 999 }, { from: 1000, to: 1999 }]);
    expect(allLogs[0].id).toBeGreaterThan(allLogs[allLogs.length - 1].id);

    const sheets = buildSsbjAuditTrailSheets({
      version: { id: VERSION, versionNumber: 3, snapshot: fictionalSnapshot },
      isApprovedVersion: true, generatedAt: '2025-08-01T00:00:00Z', generatedBy: '山田', internalRecords: false,
    }, emptyTrail, { version: versionLogs, all: allLogs }, id => id ?? '');
    const audit = sheets.find(sheet => sheet.name === '操作履歴')!.rows;
    const sectionStart = audit.findIndex(row => row[0] === '版 3 の作成・承認の記録');
    const versionSection = audit.slice(sectionStart + 2, sectionStart + 4);
    expect(versionSection.map(row => [row[2], row[5]])).toEqual([['保存版の作成', VERSION], ['状態の変更', REPORT]]);
    expect(versionSection[1][1]).toBe('approver-1');
    expect(audit).toContainEqual(['件数', '1203']);
  });

  it('承認されていない版は、その旨を書く（作成の記録だけ入る）', async () => {
    db.rows.push(log({ action: 'version_create', targetType: 'version', targetId: VERSION, details: { versionNumber: 3 } }));
    const versionLogs = await listSsbjVersionAuditLogs(REPORT, VERSION);
    const sheets = buildSsbjAuditTrailSheets({
      version: { id: VERSION, versionNumber: 3, snapshot: fictionalSnapshot },
      isApprovedVersion: false, generatedAt: '2025-08-01T00:00:00Z', generatedBy: '山田', internalRecords: false,
    }, emptyTrail, { version: versionLogs, all: [] }, id => id ?? '');
    const audit = sheets.find(sheet => sheet.name === '操作履歴')!.rows;
    expect(audit).toContainEqual(['（この版は承認されていません）']);
    expect(audit).not.toContainEqual(['（この版の作成の記録が見つかりません）']);
  });
});
