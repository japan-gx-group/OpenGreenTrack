import { describe, expect, it } from 'vitest';
import type { IdeaImportHistory, IdeaImportRecord } from '../../services/ideaImportClient';
import { buildAssignmentMessage, deleteBlockedReason } from '../ideaFiscalYearAssignment';

const record = (overrides: Partial<IdeaImportRecord>): IdeaImportRecord => ({
  id: 'imp-1',
  version: 'Ver.3.4',
  releaseDate: null,
  gwpModel: 'GWP100',
  citationText: '',
  fileName: 'idea.xlsx',
  status: 'completed',
  rowCount: 100,
  isActive: false,
  unmappedRecordCount: 0,
  skippedRowCount: 0,
  errorMessage: null,
  createdAt: '2026-04-01T00:00:00Z',
  ...overrides,
});

describe('buildAssignmentMessage', () => {
  it('割り当てた版と、付け替えた件数・選び直しが必要な件数を伝える', () => {
    expect(
      buildAssignmentMessage({
        fiscalYearLabel: '2024年度',
        assignedVersion: 'Ver.3.4',
        activeVersion: 'Ver.4.0',
        result: { importId: 'imp-1', remappedCount: 5, unmappedCount: 2 },
      }),
    ).toBe(
      '2024年度に Ver.3.4 を割り当てました。\nこの年度の未算定のデータ 5 件を、この版の製品に付け替えました。\n2 件はこの版に同じ製品が無いため、データ入力の入力履歴から開いて製品を選び直してください。',
    );
  });

  it('割り当てを外したときは、使う有効な版を伝える（有効な版が無ければ外したことだけ）', () => {
    expect(
      buildAssignmentMessage({
        fiscalYearLabel: '2024年度',
        assignedVersion: null,
        activeVersion: 'Ver.4.0',
        result: { importId: 'imp-2', remappedCount: 0, unmappedCount: 0 },
      }),
    ).toBe('2024年度の割り当てを外しました。有効な版（Ver.4.0）を使います。');
    expect(
      buildAssignmentMessage({
        fiscalYearLabel: '2024年度',
        assignedVersion: null,
        activeVersion: null,
        result: { importId: null, remappedCount: 0, unmappedCount: 0 },
      }),
    ).toBe('2024年度の割り当てを外しました。');
  });
});

describe('deleteBlockedReason', () => {
  const history = (overrides: Partial<IdeaImportHistory> = {}): IdeaImportHistory => ({
    imports: [],
    assignments: [],
    referenceCountByImportId: {},
    ...overrides,
  });

  it('有効な版・割り当て中・算定結果から参照中の版は理由を返し、それ以外は削除できる', () => {
    expect(deleteBlockedReason(record({ isActive: true }), history())).toContain('有効な版');
    expect(
      deleteBlockedReason(record({}), history({ assignments: [{ fiscalYearId: 'fy', importId: 'imp-1' }] })),
    ).toContain('割り当て中');
    expect(deleteBlockedReason(record({}), history({ referenceCountByImportId: { 'imp-1': 3 } }))).toContain(
      '算定結果から参照',
    );
    expect(deleteBlockedReason(record({}), history({ referenceCountByImportId: { 'imp-1': 0 } }))).toBeNull();
  });
});
