// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { ReadOnlyNotice } from '../ReadOnlyNotice.client';

// 閲覧者にだけ「編集はできません」の案内を出す。読込中は出さない（管理者・メンバーの画面で一瞬出さないため）。

const currentUser = vi.hoisted(() => ({
  role: null as 'admin' | 'logger' | 'viewer' | null,
  isLoading: false,
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ profile: null, role: currentUser.role, isLoading: currentUser.isLoading }),
}));

describe('ReadOnlyNotice', () => {
  let view: RenderResult | null = null;

  afterEach(() => {
    view?.unmount();
    view = null;
    currentUser.isLoading = false;
  });

  const notice = () => view?.container.querySelector('[data-testid="read-only-notice"]') ?? null;

  it('閲覧者には、編集できないことを status として出す', () => {
    currentUser.role = 'viewer';
    view = render(<ReadOnlyNotice />);
    expect(notice()?.getAttribute('role')).toBe('status');
    expect(notice()?.textContent).toContain('内容を見ることはできますが、編集はできません');
  });

  it('管理者とメンバーには出さない', () => {
    for (const role of ['admin', 'logger'] as const) {
      currentUser.role = role;
      view = render(<ReadOnlyNotice />);
      expect(notice()).toBeNull();
      view.unmount();
      view = null;
    }
  });

  it('プロフィールの読込中は出さない', () => {
    currentUser.role = null;
    currentUser.isLoading = true;
    view = render(<ReadOnlyNotice />);
    expect(notice()).toBeNull();
  });
});
