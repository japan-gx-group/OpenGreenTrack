// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { uploadEvidenceFile } from '@/features/activity-evidence/services/evidenceClient';
import { convertImageToWebp } from '@/features/activity-evidence/services/webpConversion';
import { readConvertPreference, writeConvertPreference } from '@/features/activity-evidence/services/convertPreference';
import type { EvidenceFile } from '@/features/activity-evidence/types';
import { requestInvoiceReading } from '../../services/invoiceReadingClient';
import type { InvoiceReadingResult } from '../../types';
import { MAX_LIMIT_RETRIES, useInvoiceBatchReading, type InvoiceBatchReading } from '../useInvoiceBatchReading';

// 請求書をまとめて読む流れ: 選んだだけでは送らない、1 つずつ帳票として保存してから読む、4MB を超える帳票は保存だけ、
// 回数の上限（429）は Retry-After だけ待って読み直す、「ここで止める」で残りを読まない。

vi.mock('@/features/activity-evidence/services/evidenceClient', () => ({ uploadEvidenceFile: vi.fn() }));
vi.mock('@/features/activity-evidence/services/webpConversion', () => ({ convertImageToWebp: vi.fn() }));
vi.mock('@/features/activity-evidence/services/convertPreference', () => ({
  readConvertPreference: vi.fn(() => false),
  writeConvertPreference: vi.fn(),
}));
vi.mock('../../services/invoiceReadingClient', () => ({ requestInvoiceReading: vi.fn() }));

const evidence = (id: string, overrides: Partial<EvidenceFile> = {}): EvidenceFile => ({
  id,
  fileName: `${id}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  convertedFrom: null,
  storagePath: `org/activity-evidence/${id}.pdf`,
  createdAt: '2026-10-26T00:00:00Z',
  uploadedBy: 'user-1',
  ...overrides,
});

const result = (file: EvidenceFile): InvoiceReadingResult => ({
  evidence: file,
  supplierName: null,
  supplyAddress: null,
  warnings: [],
  items: [],
  provider: 'google',
  modelId: 'gemini-3.5-flash',
});

const pdf = (name: string) => new File([new Uint8Array(16)], name, { type: 'application/pdf' });
const png = (name: string) => new File([new Uint8Array(16)], name, { type: 'image/png' });

let latest: InvoiceBatchReading | null = null;

// フックの戻り値をテスト側へ渡す。render 中の外部変数への代入は副作用になるため effect で行う。
const Probe = () => {
  const batch = useInvoiceBatchReading();
  useEffect(() => {
    latest = batch;
  });
  return null;
};

const setup = async () => {
  render(<Probe />);
  // 覚えておいた選択（WebP に変換するか）を読み終えるまで待つ。
  await act(async () => {});
  return () => latest!;
};

const statuses = (view: () => InvoiceBatchReading) => view().entries.map((entry) => entry.status);

describe('useInvoiceBatchReading', () => {
  beforeEach(() => {
    vi.mocked(uploadEvidenceFile).mockReset().mockImplementation(async (file) => evidence(file.name));
    vi.mocked(convertImageToWebp).mockReset();
    vi.mocked(readConvertPreference).mockReturnValue(false);
    vi.mocked(writeConvertPreference).mockReset();
    vi.mocked(requestInvoiceReading)
      .mockReset()
      .mockImplementation(async (id) => ({ ok: true, result: result(evidence(id)) }));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    latest = null;
  });

  it('上限を超える数は選ばせず、送れないファイルは断る。送れるファイルがあれば確認に進むだけで、まだ送らない', async () => {
    const view = await setup();

    act(() => view().selectFiles(Array.from({ length: 11 }, (_, index) => pdf(`${index}.pdf`))));
    expect(view().error).toBe('一度に選べるのは 10 ファイルまでです（11 ファイルが選ばれました）');
    expect(view().phase).toBe('idle');

    act(() => view().selectFiles([new File(['x'], 'memo.txt', { type: 'text/plain' })]));
    expect(view().error).toBeNull();
    expect(view().phase).toBe('finished');
    expect(view().entries[0]).toMatchObject({ status: 'rejected', message: 'PDF・PNG・JPEG・WebP のファイルを選んでください' });

    act(() => view().selectFiles([pdf('a.pdf'), new File(['x'], 'memo.txt', { type: 'text/plain' })]));
    expect(view().phase).toBe('confirming');
    expect(statuses(view)).toEqual(['waiting', 'rejected']);
    expect(uploadEvidenceFile).not.toHaveBeenCalled();

    act(() => view().cancel());
    expect(view().phase).toBe('idle');
    expect(view().entries).toEqual([]);
  });

  it('1 つずつ帳票として保存してから、その帳票の ID で読む（断ったファイルは読まない）', async () => {
    const view = await setup();
    act(() => view().selectFiles([pdf('a.pdf'), new File(['x'], 'memo.txt', { type: 'text/plain' }), pdf('b.pdf')]));
    await act(() => view().confirm());

    expect(vi.mocked(uploadEvidenceFile).mock.calls.map(([file, from]) => [file.name, from])).toEqual([
      ['a.pdf', null],
      ['b.pdf', null],
    ]);
    expect(vi.mocked(requestInvoiceReading).mock.calls).toEqual([['a.pdf'], ['b.pdf']]);
    expect(statuses(view)).toEqual(['done', 'rejected', 'done']);
    expect(view().results.map((entry) => entry.evidence.id)).toEqual(['a.pdf', 'b.pdf']);
    expect(view().phase).toBe('finished');
  });

  it('WebP に変換する選択なら、変換できた画像は変換後のファイルと元の形式で保存し、選択を覚える', async () => {
    vi.mocked(readConvertPreference).mockReturnValue(true);
    const converted = new File([new Uint8Array(8)], 'scan.webp', { type: 'image/webp' });
    vi.mocked(convertImageToWebp).mockResolvedValue({ converted: true, file: converted, convertedFrom: 'image/png' });
    const view = await setup();
    expect(view().convertToWebp).toBe(true);

    act(() => view().selectFiles([png('scan.png')]));
    await act(() => view().confirm());
    expect(uploadEvidenceFile).toHaveBeenCalledWith(converted, 'image/png');

    act(() => view().setConvertToWebp(false));
    expect(writeConvertPreference).toHaveBeenCalledWith(false);
  });

  it('4MB を超える帳票は保存だけして読まない。保存に失敗したファイルは理由を出して、次のファイルへ進む', async () => {
    vi.mocked(uploadEvidenceFile)
      .mockResolvedValueOnce(evidence('big', { sizeBytes: 4 * 1024 * 1024 + 1 }))
      .mockRejectedValueOnce(new Error('帳票を保存できませんでした（容量）'))
      .mockResolvedValueOnce(evidence('c'));
    const view = await setup();
    act(() => view().selectFiles([pdf('big.pdf'), pdf('b.pdf'), pdf('c.pdf')]));
    await act(() => view().confirm());

    expect(statuses(view)).toEqual(['stored_only', 'failed', 'done']);
    expect(view().entries[0].evidence?.id).toBe('big');
    expect(view().entries[1].message).toBe('帳票を保存できませんでした（容量）');
    expect(vi.mocked(requestInvoiceReading).mock.calls).toEqual([['c']]);
  });

  it('回数の上限に当たったら Retry-After の秒数だけ待って読み直し、上限の回数を超えたら失敗にする', async () => {
    vi.useFakeTimers();
    const limited = { ok: false as const, status: 429, message: '上限です', retryAfterSeconds: 5 };
    // a.pdf は 1 回だけ上限に当たり、b.pdf は上限に当たり続ける。
    let aCalls = 0;
    vi.mocked(requestInvoiceReading).mockImplementation(async (id) => {
      if (id === 'a.pdf' && (aCalls += 1) > 1) return { ok: true, result: result(evidence(id)) };
      return limited;
    });
    const view = await setup();
    act(() => view().selectFiles([pdf('a.pdf'), pdf('b.pdf')]));

    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = view().confirm();
    });
    expect(view().entries[0]).toMatchObject({
      status: 'waiting_limit',
      message: 'AI の利用回数の上限のため、5 秒待ってから読み直します',
    });
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(aCalls).toBe(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(view().entries[0].status).toBe('done');

    await act(() => vi.advanceTimersByTimeAsync(5000 * MAX_LIMIT_RETRIES));
    await act(() => running);
    expect(view().entries[1]).toMatchObject({ status: 'failed', message: '上限です' });
    const bCalls = vi.mocked(requestInvoiceReading).mock.calls.filter(([id]) => id === 'b.pdf');
    expect(bCalls).toHaveLength(1 + MAX_LIMIT_RETRIES);
  });

  it('「ここで止める」と、読み取り中のファイルが終わったところで止め、残りは読まない', async () => {
    vi.mocked(requestInvoiceReading).mockImplementationOnce(async (id) => {
      latest!.stop();
      return { ok: true, result: result(evidence(id)) };
    });
    const view = await setup();
    act(() => view().selectFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]));
    await act(() => view().confirm());

    expect(statuses(view)).toEqual(['done', 'skipped', 'skipped']);
    expect(view().entries[1].message).toBe('読み取りを止めたため、読んでいません');
    expect(uploadEvidenceFile).toHaveBeenCalledTimes(1);
    expect(view().phase).toBe('finished');
  });
});
