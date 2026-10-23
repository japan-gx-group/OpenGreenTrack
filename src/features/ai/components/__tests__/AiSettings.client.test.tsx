// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { saveAiModel } from '../../services/aiSettingsActions';
import { AiSettings } from '../AiSettings.client';

// AI の設定カードの出し分け（モデルを変えられるのは管理者だけ）と、プルダウンの状態を確かめる。
// /api/ai/status・/api/ai/models の fetch と、モデルの保存（Server Action）をモックする。

vi.mock('../../services/aiSettingsActions', () => ({ saveAiModel: vi.fn() }));

const mocks = vi.hoisted(() => ({
  status: null as unknown,
  models: { status: 200, body: {} as unknown },
  requested: [] as string[],
}));

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

const selectValue = (select: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text);

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: id,
  createdAt: null,
  deprecated: false,
  retiresOn: null,
  ...extra,
});

describe('AiSettings', () => {
  let view: RenderResult | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requested = [];
    mocks.models = { status: 200, body: { provider: 'anthropic', models: [model('claude-sonnet-5-5', { displayName: 'Claude Sonnet 5.5' }), model('claude-haiku-5-5')] } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        mocks.requested.push(input);
        if (input === '/api/ai/status') {
          return new Response(JSON.stringify(mocks.status), { status: 200 });
        }
        return new Response(JSON.stringify(mocks.models.body), { status: mocks.models.status });
      }),
    );
    vi.mocked(saveAiModel).mockResolvedValue({ ok: true, data: { modelId: 'claude-sonnet-5-5' } });
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.unstubAllGlobals();
  });

  const mount = async () => {
    view = render(<AiSettings showToast={vi.fn()} />);
    await flush();
    await flush();
    return view.container;
  };

  it('メンバーには状態だけを見せ、モデルの一覧 API を呼ばない', async () => {
    mocks.status = { keySource: 'server', configured: true, provider: 'anthropic', modelId: 'claude-sonnet-5-5', canManage: false };
    const container = await mount();
    expect(container.textContent).toContain('Anthropic（Claude）');
    expect(container.textContent).toContain('設定済み');
    expect(container.textContent).toContain('claude-sonnet-5-5');
    expect(container.textContent).toContain('管理者のみ変更できます');
    expect(container.querySelector('#ai-model')).toBeNull();
    expect(mocks.requested).toEqual(['/api/ai/status']);
  });

  it('環境変数が未設定なら、設定の手順へ案内する', async () => {
    mocks.status = { keySource: 'server', configured: false, provider: null, modelId: null, canManage: true };
    const container = await mount();
    expect(container.textContent).toContain('未設定');
    expect(container.querySelector('a[href*="setup-guide.md#2-i-"]')).not.toBeNull();
    expect(container.querySelector('#ai-model')).toBeNull();
  });

  it('管理者はモデルを選んで保存できる', async () => {
    mocks.status = { keySource: 'server', configured: true, provider: 'anthropic', modelId: null, canManage: true };
    const container = await mount();
    const select = container.querySelector<HTMLSelectElement>('#ai-model');
    expect(select).not.toBeNull();
    expect(Array.from(select?.options ?? []).map(o => o.textContent)).toEqual([
      'モデルを選んでください',
      'Claude Sonnet 5.5（claude-sonnet-5-5）',
      'claude-haiku-5-5',
    ]);
    selectValue(select as HTMLSelectElement, 'claude-sonnet-5-5');
    click(buttonByText(container, 'モデルを保存') as HTMLButtonElement);
    await flush();
    expect(saveAiModel).toHaveBeenCalledWith('claude-sonnet-5-5');
  });

  it('保存済みのモデルが提供元の一覧に無ければ、選び直すよう知らせる', async () => {
    mocks.status = { keySource: 'server', configured: true, provider: 'anthropic', modelId: 'claude-retired', canManage: true };
    const container = await mount();
    expect(container.textContent).toContain('選択中のモデル（claude-retired）は提供元の一覧にありません');
  });

  it('廃止予定のモデルは末尾にまとめ、日付を添える', async () => {
    mocks.status = { keySource: 'server', configured: true, provider: 'openai', modelId: null, canManage: true };
    mocks.models = { status: 200, body: { provider: 'openai', models: [model('gpt-5'), model('gpt-4o', { deprecated: true, retiresOn: '2027-01-15' })] } };
    const container = await mount();
    const group = container.querySelector('optgroup[label="廃止予定のモデル"]');
    expect(group?.textContent).toBe('gpt-4o — 2027-01-15 に廃止予定');
  });

  it('一覧の取得に失敗したら、その文と「再取得」を出す', async () => {
    mocks.status = { keySource: 'server', configured: true, provider: 'anthropic', modelId: null, canManage: true };
    mocks.models = { status: 502, body: { error: 'API キーが無効か、権限がありません。サーバに設定した API キーを確認してください' } };
    const container = await mount();
    expect(container.textContent).toContain('API キーが無効か、権限がありません');
    expect(buttonByText(container, '再取得')).toBeDefined();
  });
});
