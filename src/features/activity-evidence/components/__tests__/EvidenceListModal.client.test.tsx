// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { EvidenceFileListItem } from '../../types';
import { deleteEvidenceFile, getUploaderNames, listEvidenceFiles, openEvidenceFile } from '../../services/evidenceClient';
import { EvidenceListModal } from '../EvidenceListModal.client';

// 「帳票の一覧」: 組織の帳票を並べ、紐づいていない帳票だけを 2 回押して削除できる。

vi.mock('../../services/evidenceClient', () => ({
  listEvidenceFiles: vi.fn(),
  getUploaderNames: vi.fn(),
  deleteEvidenceFile: vi.fn(),
  openEvidenceFile: vi.fn(),
}));

const file = (overrides: Partial<EvidenceFileListItem>): EvidenceFileListItem => ({
  id: 'file-1',
  fileName: '9月分.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  convertedFrom: null,
  storagePath: 'org/activity-evidence/file-1.pdf',
  createdAt: '2026-10-26T01:00:00Z',
  uploadedBy: 'user-1',
  linkCount: 0,
  ...overrides,
});

let view: RenderResult | null = null;
const flush = () => act(async () => {});
const buttonByLabel = (label: string) => document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === text);

describe('EvidenceListModal', () => {
  beforeEach(() => {
    vi.mocked(listEvidenceFiles).mockResolvedValue([
      file({}),
      file({ id: 'file-2', fileName: '燃料.webp', mimeType: 'image/webp', convertedFrom: 'image/png', linkCount: 3 }),
    ]);
    vi.mocked(getUploaderNames).mockResolvedValue(new Map([['user-1', '環境 太郎']]));
    vi.mocked(deleteEvidenceFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(openEvidenceFile).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
  });

  it('帳票を並べ、紐づいている数と上げた人を出す', async () => {
    view = render(<EvidenceListModal isOpen onClose={vi.fn()} />);
    await flush();
    const text = document.body.textContent ?? '';
    expect(text).toContain('9月分.pdf');
    expect(text).toContain('紐づけなし');
    expect(text).toContain('燃料.webp');
    expect(text).toContain('WebP・2 KB（PNG から変換）');
    expect(text).toContain('3 件に紐づけ');
    expect(text).toContain('環境 太郎');
  });

  it('紐づいている帳票は削除できない', async () => {
    view = render(<EvidenceListModal isOpen onClose={vi.fn()} />);
    await flush();
    expect(buttonByLabel('燃料.webp を削除')?.disabled).toBe(true);
    expect(buttonByLabel('9月分.pdf を削除')?.disabled).toBe(false);
  });

  it('紐づいていない帳票は、もう一度「削除する」を押したときだけ消し、一覧から外す', async () => {
    view = render(<EvidenceListModal isOpen onClose={vi.fn()} />);
    await flush();
    click(buttonByLabel('9月分.pdf を削除')!);
    expect(deleteEvidenceFile).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText('削除する')!.click();
    });
    expect(deleteEvidenceFile).toHaveBeenCalledWith('file-1');
    expect(document.body.textContent).not.toContain('9月分.pdf');
  });

  it('「紐づいていない帳票だけ」で絞り込める', async () => {
    view = render(<EvidenceListModal isOpen onClose={vi.fn()} />);
    await flush();
    const checkbox = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((input) =>
      input.parentElement?.textContent?.includes('紐づいていない帳票だけ'),
    )!;
    click(checkbox);
    expect(document.body.textContent).toContain('9月分.pdf');
    expect(document.body.textContent).not.toContain('燃料.webp');
  });

  it('「開く」で帳票を新しいタブで開く', async () => {
    view = render(<EvidenceListModal isOpen onClose={vi.fn()} />);
    await flush();
    click(buttonByLabel('9月分.pdf を開く')!);
    expect(openEvidenceFile).toHaveBeenCalledWith('org/activity-evidence/file-1.pdf');
  });

  it('閉じている間は読み込まない', async () => {
    vi.mocked(listEvidenceFiles).mockClear();
    view = render(<EvidenceListModal isOpen={false} onClose={vi.fn()} />);
    await flush();
    expect(listEvidenceFiles).not.toHaveBeenCalled();
  });
});
