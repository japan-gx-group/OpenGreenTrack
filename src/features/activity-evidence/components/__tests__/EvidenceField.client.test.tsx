// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { EvidenceFile } from '../../types';
import { uploadEvidenceFile } from '../../services/evidenceClient';
import { convertImageToWebp } from '../../services/webpConversion';
import { useEvidenceAttachments, type UseEvidenceAttachmentsArgs } from '../../hooks/useEvidenceAttachments';
import { EvidenceField } from '../EvidenceField.client';

// 帳票の欄: 「WebP に変換して容量を減らす」を選ぶと画像を変換してから上げ、選択をこのブラウザに覚える。

vi.mock('../../services/evidenceClient', () => ({
  uploadEvidenceFile: vi.fn(),
  getRecordEvidence: vi.fn(async () => []),
  linkEvidence: vi.fn(),
  unlinkEvidence: vi.fn(),
  openEvidenceFile: vi.fn(),
}));
vi.mock('../../services/webpConversion', () => ({ convertImageToWebp: vi.fn() }));

const uploaded: EvidenceFile = {
  id: 'file-1',
  fileName: 'scan.webp',
  mimeType: 'image/webp',
  sizeBytes: 300,
  convertedFrom: 'image/png',
  storagePath: 'org/activity-evidence/file-1.webp',
  createdAt: '2026-10-26T00:00:00Z',
  uploadedBy: 'user-1',
};

const Harness = (args: UseEvidenceAttachmentsArgs) => {
  const attachments = useEvidenceAttachments(args);
  return <EvidenceField attachments={attachments} isEdit={false} />;
};

let view: RenderResult | null = null;

const convertCheckbox = () =>
  Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find((input) =>
    input.parentElement?.textContent?.includes('WebP に変換'),
  )!;

const choose = async (file: File) => {
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="帳票のファイル"]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('EvidenceField', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(uploadEvidenceFile).mockReset().mockResolvedValue(uploaded);
    vi.mocked(convertImageToWebp).mockReset();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
  });

  it('既定では変換せずに上げる', async () => {
    view = render(<Harness />);
    await choose(new File([new Uint8Array(1000)], 'scan.png', { type: 'image/png' }));
    expect(convertImageToWebp).not.toHaveBeenCalled();
    expect(uploadEvidenceFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'scan.png' }), null);
  });

  it('変換を選ぶと WebP にしてから、元の形式を添えて上げ、選択を覚える', async () => {
    const webp = new File([new Uint8Array(300)], 'scan.webp', { type: 'image/webp' });
    vi.mocked(convertImageToWebp).mockResolvedValue({ converted: true, file: webp, convertedFrom: 'image/png' });
    view = render(<Harness />);
    click(convertCheckbox());
    await choose(new File([new Uint8Array(1000)], 'scan.png', { type: 'image/png' }));

    expect(uploadEvidenceFile).toHaveBeenCalledWith(webp, 'image/png');
    expect(document.body.textContent).toContain('WebP・1 KB（PNG から変換）');
    expect(window.localStorage.getItem('ogt.activityEvidence.convertToWebp')).toBe('true');
  });

  it('覚えておいた選択で始まる', async () => {
    window.localStorage.setItem('ogt.activityEvidence.convertToWebp', 'true');
    view = render(<Harness />);
    await act(async () => {});
    expect(convertCheckbox().checked).toBe(true);
  });

  it('変換できなかったときは元のファイルのまま上げる', async () => {
    const original = new File([new Uint8Array(1000)], 'scan.png', { type: 'image/png' });
    vi.mocked(convertImageToWebp).mockResolvedValue({ converted: false, file: original, reason: 'unsupported' });
    view = render(<Harness />);
    click(convertCheckbox());
    await choose(original);
    expect(uploadEvidenceFile).toHaveBeenCalledWith(original, null);
  });

  it('上げられなかったときはファイル名を添えて理由を出す', async () => {
    vi.mocked(uploadEvidenceFile).mockRejectedValue(new Error('帳票を保存できませんでした'));
    view = render(<Harness />);
    await choose(new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }));
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('a.pdf: 帳票を保存できませんでした');
  });
});
