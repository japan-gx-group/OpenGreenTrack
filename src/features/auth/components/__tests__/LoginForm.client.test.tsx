// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { LoginForm } from '../LoginForm.client';

// App Router のフックと Supabase クライアントは画面外の依存なので固定値を返す。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: vi.fn() } }),
  setSessionPersistence: vi.fn(),
}));

const DEMO_HINT = 'ローカル確認用';
const SETUP_LINK = '初期セットアップ';

describe('LoginForm', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllEnvs();
  });

  // デモアカウント（org-a@example.com 等）はデモシード投入後にしか存在しない。
  // 未セットアップ環境（組織 0 件）で案内を出すと、ログインできないアカウントを勧めることになる。
  it('開発モードでも、未セットアップ環境ではデモアカウント案内を出さない', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { container, unmount } = render(<LoginForm showSetupLink />);

    expect(container.textContent).not.toContain(DEMO_HINT);
    expect(container.textContent).toContain(SETUP_LINK);
    unmount();
  });

  it('開発モードかつセットアップ済みならデモアカウント案内を出す', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { container, unmount } = render(<LoginForm showSetupLink={false} />);

    expect(container.textContent).toContain(DEMO_HINT);
    expect(container.textContent).not.toContain(SETUP_LINK);
    unmount();
  });

  it('本番ビルドではセットアップ状態によらずデモアカウント案内を出さない', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { container, unmount } = render(<LoginForm showSetupLink={false} />);

    expect(container.textContent).not.toContain(DEMO_HINT);
    unmount();
  });
});
