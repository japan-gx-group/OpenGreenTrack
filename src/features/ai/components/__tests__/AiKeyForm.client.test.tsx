// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { deleteAiCredential, saveAiCredential } from '../../services/aiCredentialActions';
import { AiKeyForm } from '../AiKeyForm.client';

// 方式B の鍵のフォーム: 提供元・API キー・ログインパスワード（本人確認）がそろうまで押せず、
// 送った後は入力を消すことを確かめる。Server Action はモックする。

vi.mock('../../services/aiCredentialActions', () => ({
  saveAiCredential: vi.fn(),
  deleteAiCredential: vi.fn(),
}));

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text);

// テストの鍵は同じ文字の繰り返しで作る（鍵らしい文字列をソースに書くと gitleaks に当たるため）。
const API_KEY = 'x'.repeat(30);

describe('AiKeyForm', () => {
  let view: RenderResult | null = null;
  const onChanged = vi.fn();
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveAiCredential).mockResolvedValue({ ok: true, data: { provider: 'openai', last4: 'xxxx' } });
    vi.mocked(deleteAiCredential).mockResolvedValue({ ok: true, data: undefined });
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('許可された提供元だけを選べ、3 つの入力がそろうまで登録できない。登録後は入力を消す', async () => {
    view = render(
      <AiKeyForm mode="register" allowedProviders={['anthropic', 'openai']} registeredKey={null} showToast={showToast} onChanged={onChanged} />,
    );
    const { container } = view;
    const provider = container.querySelector<HTMLSelectElement>('#ai-key-provider');
    expect(Array.from(provider?.options ?? []).map(o => o.value)).toEqual(['anthropic', 'openai']);
    expect(container.textContent).toContain('AI 提供元のパスワードではありません');

    const register = () => buttonByText(container, '登録する') as HTMLButtonElement;
    expect(register().disabled).toBe(true);
    setInputValue(container.querySelector('#ai-key-value') as HTMLInputElement, API_KEY);
    expect(register().disabled).toBe(true);
    setInputValue(container.querySelector('#ai-key-reauth') as HTMLInputElement, 'login-password');
    expect(register().disabled).toBe(false);
    // 鍵とパスワードの入力欄は伏せ字
    expect(container.querySelector<HTMLInputElement>('#ai-key-value')?.type).toBe('password');
    expect(container.querySelector<HTMLInputElement>('#ai-key-reauth')?.type).toBe('password');

    click(register());
    await flush();

    expect(saveAiCredential).toHaveBeenCalledWith({ provider: 'anthropic', apiKey: API_KEY, password: 'login-password' });
    expect(onChanged).toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('#ai-key-value')?.value).toBe('');
    expect(container.querySelector<HTMLInputElement>('#ai-key-reauth')?.value).toBe('');
  });

  it('登録済みなら差し替えと削除を出す。削除にも本人確認のパスワードを送る', async () => {
    view = render(
      <AiKeyForm
        mode="register"
        allowedProviders={['openai']}
        registeredKey={{ provider: 'openai', last4: 'a1b2', updatedAt: '2026-10-24T00:00:00Z' }}
        showToast={showToast}
        onChanged={onChanged}
      />,
    );
    const { container } = view;
    expect(buttonByText(container, '差し替える')).toBeDefined();
    setInputValue(container.querySelector('#ai-key-reauth') as HTMLInputElement, 'login-password');
    click(buttonByText(container, '登録した API キーを削除') as HTMLButtonElement);
    await flush();
    expect(deleteAiCredential).toHaveBeenCalledWith({ password: 'login-password' });
  });

  it('失敗したら、その理由を出して入力を残す', async () => {
    vi.mocked(saveAiCredential).mockResolvedValue({ ok: false, error: 'ログインパスワードが正しくありません' });
    view = render(
      <AiKeyForm mode="register" allowedProviders={['openai']} registeredKey={null} showToast={showToast} onChanged={onChanged} />,
    );
    const { container } = view;
    setInputValue(container.querySelector('#ai-key-value') as HTMLInputElement, API_KEY);
    setInputValue(container.querySelector('#ai-key-reauth') as HTMLInputElement, 'wrong');
    click(buttonByText(container, '登録する') as HTMLButtonElement);
    await flush();
    expect(showToast).toHaveBeenCalledWith('ログインパスワードが正しくありません', 'error');
    expect(onChanged).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('#ai-key-value')?.value).toBe(API_KEY);
  });

  it('方式A で鍵が残っているときは、削除だけを出す', () => {
    view = render(<AiKeyForm mode="cleanup" allowedProviders={[]} registeredKey={null} showToast={showToast} onChanged={onChanged} />);
    const { container } = view;
    expect(container.textContent).toContain('以前に画面から登録した API キーが DB に残っています');
    expect(container.querySelector('#ai-key-value')).toBeNull();
    expect(buttonByText(container, '残っている API キーを削除')).toBeDefined();
  });
});
