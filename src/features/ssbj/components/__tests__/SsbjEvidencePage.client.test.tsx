// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { FICTIONAL_DRAFT_REVIEW, fictionalEvidence, fictionalReportBasicInfo } from '../../__fixtures__/fictionalReport';

vi.mock('../../services/reportService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/reportService')>()),
  getSsbjReport: vi.fn(),
}));
vi.mock('../../services/evidenceService', () => ({
  listSsbjEvidence: vi.fn(),
  createSsbjEvidence: vi.fn(),
  updateSsbjEvidence: vi.fn(),
  deleteSsbjEvidence: vi.fn(),
}));


// SSBJ のロールは、既定で入力担当として操作する（編集の操作を出す）。
vi.mock('../../services/memberRoleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberRoleService')>()),
  getMySsbjRole: vi.fn(async () => 'editor'),
}));
import { getSsbjReport } from '../../services/reportService';
import { createSsbjEvidence, deleteSsbjEvidence, listSsbjEvidence, updateSsbjEvidence } from '../../services/evidenceService';
import { SsbjEvidencePage } from '../SsbjEvidencePage.client';

const report = {
  ...fictionalReportBasicInfo,
  fiscalYearLabel: '2024年度',
  periodStart: '2024-04-01',
  periodEnd: '2025-03-31',
  draftRevision: 1,
  basicInfoRevision: 0,
  review: FICTIONAL_DRAFT_REVIEW,
};

let mounted: RenderResult | null = null;
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const button = (label: string, root: ParentNode = document) => {
  const found = [...root.querySelectorAll('button')].find(node => node.textContent?.trim() === label);
  if (!found) throw new Error(`ボタンが見つかりません: ${label}`);
  return found;
};

beforeEach(() => {
  vi.mocked(getSsbjReport).mockResolvedValue(report);
  vi.mocked(listSsbjEvidence).mockResolvedValue(fictionalEvidence);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.clearAllMocks();
});

const open = async () => {
  mounted = render(<SsbjEvidencePage reportId={report.id} />);
  await flush();
  await flush();
};

// SHA-256 の計算（Web Crypto）は非同期に終わるため、タイマーを数回回して反映を待つ。
const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  }
};
const chooseFile = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
};
const dialogElement = () => {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) throw new Error('ダイアログがありません');
  return dialog;
};
// 架空の根拠文書（fictionalEvidence[0]）に記録した SHA-256 の元になった中身。
const RECORDED_CONTENT = '取締役会議事録（架空）の PDF の中身';

describe('SsbjEvidencePage', () => {
  it('内部保管先と開示用参照文を別の行に表示する', async () => {
    await open();
    expect(document.body.textContent).toContain('取締役会の開催記録に基づく。');
    expect(document.body.textContent).toContain('保管先（内部記録）');
    expect(document.body.textContent).toContain('社内共有フォルダ/議事録（架空）');
    expect(document.body.textContent).toContain('主管部署（内部記録）');
  });

  it('存在しないレポートの根拠文書を読まない', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue(null);
    await open();
    expect(document.body.textContent).toContain('SSBJレポートが見つかりません');
    expect(listSsbjEvidence).not.toHaveBeenCalled();
  });

  it('主管部署が空でも項目IDと資料名で登録できる', async () => {
    const saved = {
      ...fictionalEvidence[1], id: 'new-evidence', itemId: 'governance.new_item' as const,
      documentTitle: '追加資料', disclosure: { state: 'unanswered' as const },
    };
    vi.mocked(createSsbjEvidence).mockResolvedValue(saved);
    await open();
    click(button('根拠文書を追加'));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) throw new Error('ダイアログがありません');
    setInputValue(dialog.querySelector<HTMLInputElement>('#evidence-slug')!, 'new_item');
    setInputValue(dialog.querySelector<HTMLInputElement>('#evidence-title')!, '追加資料');
    click(button('保存する', dialog));
    await flush();
    expect(createSsbjEvidence).toHaveBeenCalledWith(report, expect.objectContaining({
      itemId: 'governance.new_item', documentTitle: '追加資料', ownerDepartment: null,
    }));
    expect(document.body.textContent).toContain('追加資料');
  });

  it('編集した資料を一覧に反映し、削除後は作業中の一覧から除く', async () => {
    const edited = { ...fictionalEvidence[0], documentTitle: '改訂版議事録' };
    vi.mocked(updateSsbjEvidence).mockResolvedValue(edited);
    vi.mocked(deleteSsbjEvidence).mockResolvedValue();
    await open();
    click(button('編集'));
    const editDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!editDialog) throw new Error('編集ダイアログがありません');
    setInputValue(editDialog.querySelector<HTMLInputElement>('#evidence-title')!, '改訂版議事録');
    click(button('保存する', editDialog));
    await flush();
    expect(updateSsbjEvidence).toHaveBeenCalledWith(fictionalEvidence[0].id, expect.objectContaining({ documentTitle: '改訂版議事録' }));
    expect(document.body.textContent).toContain('改訂版議事録');

    click(button('削除'));
    const deleteDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!deleteDialog) throw new Error('削除ダイアログがありません');
    click(button('削除する', deleteDialog));
    await flush();
    expect(deleteSsbjEvidence).toHaveBeenCalledWith(edited.id);
    expect(document.body.textContent).not.toContain('改訂版議事録');
  });
});

describe('SsbjEvidencePage（ファイルの SHA-256）', () => {
  it('ファイルを選ぶと SHA-256 を計算して記録し、ファイル本体は保存に渡さない', async () => {
    vi.mocked(createSsbjEvidence).mockImplementation(async (_report, input) => ({
      ...input, id: 'new-evidence', fileRecordedAt: '2025-06-05T00:00:00.000Z',
    }));
    await open();
    click(button('根拠文書を追加'));
    const dialog = dialogElement();
    setInputValue(dialog.querySelector<HTMLInputElement>('#evidence-slug')!, 'new_item');
    setInputValue(dialog.querySelector<HTMLInputElement>('#evidence-title')!, '追加資料');
    await chooseFile(dialog.querySelector<HTMLInputElement>('#evidence-file')!, new File(['abc'], 'minutes.pdf'));
    const sha256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(dialog.querySelector('[data-testid="ssbj-evidence-file-record"]')?.textContent).toContain(sha256);
    setInputValue(dialog.querySelector<HTMLInputElement>('#evidence-storage-version')!, 'v7');
    click(button('保存する', dialog));
    await flush();

    expect(createSsbjEvidence).toHaveBeenCalledWith(report, expect.objectContaining({
      fileName: 'minutes.pdf', fileSha256: sha256, fileStorageVersionId: 'v7', fileStoredBy: null,
    }));
    const input = vi.mocked(createSsbjEvidence).mock.calls[0][1];
    expect(Object.values(input).some(value => value instanceof Blob)).toBe(false);
    expect(document.body.textContent).toContain(sha256);
  });

  it('照合で、同じファイルなら「一致」、1 バイトでも違えば「不一致」を出す', async () => {
    await open();
    click(button('照合'));
    const dialog = dialogElement();
    const input = dialog.querySelector<HTMLInputElement>('#evidence-verify-file')!;
    const result = () => dialog.querySelector<HTMLElement>('[data-testid="ssbj-evidence-verify-result"]');

    await chooseFile(input, new File([RECORDED_CONTENT], '別名で保存した議事録.pdf'));
    expect(result()?.dataset.result).toBe('match');
    expect(result()?.textContent).toContain('一致しました');

    await chooseFile(input, new File([`${RECORDED_CONTENT} `], '取締役会議事録_2024年度（架空）.pdf'));
    expect(result()?.dataset.result).toBe('mismatch');
    expect(result()?.textContent).toContain('一致しません');
    expect(createSsbjEvidence).not.toHaveBeenCalled();
    expect(updateSsbjEvidence).not.toHaveBeenCalled();
  });

  it('ファイルの記録を外して保存できる', async () => {
    vi.mocked(updateSsbjEvidence).mockImplementation(async (id, input) => ({ ...input, id, fileRecordedAt: null }));
    await open();
    click(button('編集'));
    const dialog = dialogElement();
    expect(dialog.textContent).toContain(fictionalEvidence[0].fileSha256);
    click(button('ファイルの記録を外す', dialog));
    click(button('保存する', dialog));
    await flush();
    expect(updateSsbjEvidence).toHaveBeenCalledWith(fictionalEvidence[0].id, expect.objectContaining({
      fileName: null, fileSha256: null, fileStorageVersionId: '3.0',
    }));
  });
});

describe('SsbjEvidencePage（承認ロック）', () => {
  it('承認済みのレポートでは追加・編集・削除を出さず、ロックの案内を出す', async () => {
    vi.mocked(getSsbjReport).mockResolvedValue({ ...report, review: { status: 'approved' as const, approverUserId: 'u', approvedAt: '2025-06-05T00:00:00.000Z', approvedByUserId: 'u',
      approvedVersionId: null, statusChangedAt: null, reviewRequestedByUserId: null } });
    await open();
    const labels = Array.from(document.querySelectorAll('button')).map(element => element.textContent?.trim());
    expect(labels.some(label => label?.includes('根拠文書を追加'))).toBe(false);
    expect(labels.some(label => label?.endsWith('編集') || label?.endsWith('削除'))).toBe(false);
    expect(document.querySelector('[data-testid="ssbj-locked-notice"]')).not.toBeNull();
    // 照合は何も保存しないため、承認済みでも使える（ファイルの記録がある根拠にだけ出す）。
    expect(labels.filter(label => label === '照合')).toHaveLength(1);
  });
});
