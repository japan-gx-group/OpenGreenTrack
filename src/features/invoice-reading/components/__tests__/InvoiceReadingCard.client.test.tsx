// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import type { AiStatus } from '@/types/ai';
import type { InvoiceReadingResult } from '../../types';
import { InvoiceReadingCard } from '../InvoiceReadingCard.client';

// 「請求書から読み取る」カード: AI が使えないときは選べない、送る前に確認を出す、結果の明細から「フォームに反映」できる。

const statusMock = vi.hoisted(() => ({
  value: { status: null as AiStatus | null, error: null as string | null, isLoading: false },
}));
vi.mock('@/features/ai/hooks/useAiStatus', () => ({
  useAiStatus: () => ({ ...statusMock.value, refresh: async () => {} }),
}));

const STATUS: AiStatus = {
  keySource: 'server',
  configured: true,
  provider: 'google',
  modelId: 'gemini-3.5-flash',
  canManage: false,
  allowedProviders: [],
  registeredKey: null,
  needsReRegistration: false,
  leftoverKey: false,
};

const RESULT: InvoiceReadingResult = {
  supplierName: '東京電力エナジーパートナー株式会社',
  supplyAddress: '東京都架空区架空町1-1-1',
  warnings: ['一部が読めませんでした'],
  provider: 'google',
  modelId: 'gemini-3.5-flash',
  items: [
    {
      index: 1,
      energyType: 'electricity',
      title: '電気 2025年9月分',
      targetMonth: '2025-09',
      amount: { value: 12345, unit: 'kWh' },
      printedAmount: '12,345 kWh',
      planOrFuelName: 'スタンダードS',
      factor: { status: 'matched', label: '東京電力エナジーパートナー(株) / メニューL(残差)', reason: '残差を選んだ' },
      location: { id: 'tokyo', name: '東京本社' },
      notices: [],
      prefill: {
        locationId: 'tokyo',
        supplyAddress: '東京都架空区架空町1-1-1',
        energyType: 'electricity',
        targetMonth: '2025-09',
        amount: '12345',
        note: '請求書から読取り',
        factor: { kind: 'provider', providerName: '東京電力エナジーパートナー(株)', menuName: 'メニューL(残差)' },
        sourceLabel: '請求書「9月分.pdf」から読み取った値を入れました。',
      },
    },
  ],
};

let view: RenderResult | null = null;

const buttonByText = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === text);

const chooseFile = (file: File) => {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]')!;
  act(() => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const flush = () => act(async () => {});

describe('InvoiceReadingCard', () => {
  beforeEach(() => {
    statusMock.value = { status: STATUS, error: null, isLoading: false };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('AI が未設定・モデル未選択のときは理由を出し、ファイルを選べない', () => {
    statusMock.value = { status: { ...STATUS, modelId: null }, error: null, isLoading: false };
    view = render(<InvoiceReadingCard onApply={vi.fn()} />);
    expect(document.body.textContent).toContain('AI のモデルが選ばれていません');
    expect((buttonByText('ファイルを選ぶ') as HTMLButtonElement).disabled).toBe(true);
  });

  it('ファイルを選ぶと送信の確認を出し、「やめる」では送らない', () => {
    view = render(<InvoiceReadingCard onApply={vi.fn()} />);
    chooseFile(new File([new Uint8Array(2048)], '9月分.pdf', { type: 'application/pdf' }));
    expect(document.body.textContent).toContain('「請求書の読取り」のため');
    expect(document.body.textContent).toContain('9月分.pdf（2 KB）');
    expect(document.body.textContent).toContain('読み取った事業者名・料金メニュー・燃料の名称と、排出係数の候補（公表値）');
    click(buttonByText('やめる')!);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('送れない種類・大きすぎるファイルは、確認を出さずに理由を出す', () => {
    view = render(<InvoiceReadingCard onApply={vi.fn()} />);
    chooseFile(new File(['x'], 'memo.txt', { type: 'text/plain' }));
    expect(document.body.textContent).toContain('PDF・PNG・JPEG・WebP のファイルを選んでください');
    chooseFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }));
    expect(document.body.textContent).toContain('ファイルが大きすぎます');
    expect(document.body.textContent).not.toContain('「請求書の読取り」のため');
  });

  it('「送信する」で送り、明細と係数の判定を見せ、「フォームに反映」で値を渡す', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(RESULT), { status: 200 }));
    const onApply = vi.fn();
    view = render(<InvoiceReadingCard onApply={onApply} />);
    chooseFile(new File([new Uint8Array(10)], '9月分.pdf', { type: 'application/pdf' }));
    click(buttonByText('送信する')!);
    await flush();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/ai/invoice-reading');
    expect((init?.body as FormData).get('file')).toBeInstanceOf(File);
    expect(document.body.textContent).toContain('電気 2025年9月分');
    expect(document.body.textContent).toContain('当てはまる係数あり');
    expect(document.body.textContent).toContain('東京電力エナジーパートナー(株) / メニューL(残差)');
    expect(document.body.textContent).toContain('AI の判断: 残差を選んだ');
    expect(document.body.textContent).toContain('東京本社（住所が一致）');
    expect(document.body.textContent).toContain('一部が読めませんでした');

    click(buttonByText('フォームに反映')!);
    expect(onApply).toHaveBeenCalledWith(RESULT.items[0].prefill);
  });

  it('サーバの文をそのまま出す（提供元のエラー本文は出さない）', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'AI の利用回数の上限に達しました。時間をおいてお試しください' }), { status: 429 }),
    );
    view = render(<InvoiceReadingCard onApply={vi.fn()} />);
    chooseFile(new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }));
    click(buttonByText('送信する')!);
    await flush();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      'AI の利用回数の上限に達しました。時間をおいてお試しください',
    );
  });
});
