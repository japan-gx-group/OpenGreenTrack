// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import {
  fetchIdeaImportOverview,
  requestStaleIdeaImportRecovery,
  type IdeaImportRecord,
} from '../../services/ideaImportClient';
import { IdeaDatabaseCard } from '../IdeaDatabaseCard.client';

// 取込の裏の処理が中断されると取込記録が processing のまま残る。カードは取込中の間ほかの取込操作を
// 受け付けないため、取込中の表示を出している間に回収を依頼し、回収されたら失敗として表示して
// 再取込できる状態に戻ることを検証する。

vi.mock('../../services/ideaImportClient', () => ({
  fetchIdeaImportOverview: vi.fn(),
  requestStaleIdeaImportRecovery: vi.fn(),
  startIdeaImport: vi.fn(),
  deleteIdeaImport: vi.fn(),
}));

const record = (overrides: Partial<IdeaImportRecord>): IdeaImportRecord => ({
  id: 'import-1',
  version: '',
  releaseDate: null,
  gwpModel: 'GWP100',
  citationText: '',
  fileName: 'idea.xlsx',
  status: 'processing',
  rowCount: 0,
  isActive: false,
  unmappedRecordCount: 0,
  skippedRowCount: 0,
  errorMessage: null,
  createdAt: '2026-10-19T00:00:00.000Z',
  ...overrides,
});

let view: RenderResult;

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('IdeaDatabaseCard（中断された取込の回収）', () => {
  beforeEach(() => {
    vi.mocked(requestStaleIdeaImportRecovery).mockResolvedValue(undefined);
  });

  afterEach(() => {
    view?.unmount();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('取込中の表示を見つけたら回収を依頼し、回収された取込は失敗として表示して再取込できるようにする', async () => {
    const stuck = record({ status: 'processing' });
    const recovered = record({
      status: 'failed',
      errorMessage: '取込が完了しないまま中断された可能性があります。再度取り込んでください',
    });
    // 初回表示は取込中。回収の依頼後に読み直すと失敗に変わっている。
    vi.mocked(fetchIdeaImportOverview)
      .mockResolvedValueOnce({ active: null, latest: stuck })
      .mockResolvedValue({ active: null, latest: recovered });

    view = render(<IdeaDatabaseCard />);
    await flush();
    await flush();
    await flush();

    expect(requestStaleIdeaImportRecovery).toHaveBeenCalledTimes(1);
    const text = view.container.textContent ?? '';
    expect(text).toContain('取込に失敗しました');
    expect(text).toContain('中断された可能性があります');
    expect(text).not.toContain('を取込中です');
    // 取込中でなくなったので、ファイル選択が再び使える
    expect(view.container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(false);
  });

  it('取込中でなければ回収を依頼しない', async () => {
    vi.mocked(fetchIdeaImportOverview).mockResolvedValue({
      active: record({ status: 'completed', isActive: true, version: 'Ver.4.0' }),
      latest: record({ status: 'completed', isActive: true, version: 'Ver.4.0' }),
    });

    view = render(<IdeaDatabaseCard />);
    await flush();
    await flush();

    expect(requestStaleIdeaImportRecovery).not.toHaveBeenCalled();
  });
});
