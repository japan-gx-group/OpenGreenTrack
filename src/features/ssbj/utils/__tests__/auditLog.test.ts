import { describe, expect, it } from 'vitest';
import type { SsbjAuditLog } from '../../types';
import {
  SSBJ_AUDIT_ACTION_LABELS,
  SSBJ_AUDIT_EXPORT_HEADER,
  ssbjAuditDetail,
  ssbjAuditExportRows,
  ssbjAuditTargetLabel,
} from '../auditLog';

const log = (overrides: Partial<SsbjAuditLog>): SsbjAuditLog => ({
  id: 1,
  reportId: 'report-1',
  actorUserId: 'user-1',
  action: 'update',
  targetType: 'report',
  targetId: 'report-1',
  changedColumns: null,
  details: {},
  createdAt: '2025-06-05T01:02:03.000Z',
  ...overrides,
});
const names: Record<string, string> = { 'user-1': '環境 太郎', 'user-2': '算定 花子' };
const nameOf = (userId: string | null) => (userId ? names[userId] ?? '不明な利用者' : 'システム');

describe('ssbjAuditTargetLabel', () => {
  it('文章は項目名、判断は要求 ID と要約、リスク・根拠は名前、保存版は版番号で出す', () => {
    expect(ssbjAuditTargetLabel(log({ targetType: 'narrative', targetId: 'governance.oversight_body' })))
      .toBe('四本柱の文章: 監督する機関・責任者');
    expect(ssbjAuditTargetLabel(log({ targetType: 'judgement', targetId: 'REQ-CLM-020' }))).toContain('REQ-CLM-020（');
    expect(ssbjAuditTargetLabel(log({ targetType: 'risk_opportunity', details: { label: '炭素価格の導入' } })))
      .toBe('リスク・機会: 炭素価格の導入');
    expect(ssbjAuditTargetLabel(log({ targetType: 'version', details: { versionNumber: 3 } }))).toBe('保存版: 版 3');
    expect(ssbjAuditTargetLabel(log({ targetType: 'narrative', targetId: 'governance.removed_item' })))
      .toBe('四本柱の文章: governance.removed_item');
  });
});

describe('ssbjAuditDetail', () => {
  it('更新は変わった項目を画面の言葉で並べる', () => {
    expect(ssbjAuditDetail(log({ changedColumns: ['disclosureText', 'internalNote'] }), nameOf)).toBe('開示する内容、内部メモ');
  });

  it('状態の変更は操作・前後の状態・承認者・承認した版・コメントを出す', () => {
    expect(ssbjAuditDetail(log({
      action: 'status_change',
      details: { operation: 'submit', from: 'draft', to: 'in_review', approverUserId: 'user-2', comment: 'お願いします' },
    }), nameOf)).toBe('レビュー依頼（作成中 → レビュー中） / 承認者: 算定 花子 / コメント: お願いします');
    expect(ssbjAuditDetail(log({
      action: 'status_change', details: { operation: 'approve', from: 'in_review', to: 'approved', versionNumber: 2 },
    }), nameOf)).toBe('承認（レビュー中 → 承認済み） / 承認した版: 版 2');
  });

  it('復元・出力・保存版の作成の中身を出す', () => {
    expect(ssbjAuditDetail(log({ action: 'version_restore', details: { versionNumber: 1, backupVersionNumber: 4 } }), nameOf))
      .toBe('版 1 の内容に戻した（戻す前の内容は 版 4）');
    expect(ssbjAuditDetail(log({ action: 'export', details: { format: 'xlsx', versionNumber: 2 } }), nameOf))
      .toBe('保存版の Excel（版 2）');
    expect(ssbjAuditDetail(log({ action: 'export', details: { format: 'audit_csv' } }), nameOf)).toBe('操作履歴の CSV');
    expect(ssbjAuditDetail(log({ action: 'version_create', details: { note: '承認時の保存版' } }), nameOf)).toBe('承認時の保存版');
  });
});

describe('ssbjAuditExportRows', () => {
  it('見出しと 1 件 1 行で出し、操作した人は名前、操作者の無い記録は「システム」にする', () => {
    const rows = ssbjAuditExportRows(
      [log({ action: 'create', targetType: 'narrative', targetId: 'governance.oversight_body' }), log({ id: 2, actorUserId: null })],
      nameOf, 'テストレポート', '2025-06-06T00:00:00.000Z',
    );
    const headerIndex = rows.findIndex(row => row[0] === SSBJ_AUDIT_EXPORT_HEADER[0]);
    expect(rows[headerIndex]).toEqual(SSBJ_AUDIT_EXPORT_HEADER);
    expect(rows[headerIndex + 1]).toEqual([
      '2025-06-05T01:02:03.000Z', '環境 太郎', SSBJ_AUDIT_ACTION_LABELS.create,
      '四本柱の文章: 監督する機関・責任者', '', 'governance.oversight_body',
    ]);
    expect(rows[headerIndex + 2][1]).toBe('システム');
    expect(rows).toContainEqual(['件数', '2']);
  });
});
