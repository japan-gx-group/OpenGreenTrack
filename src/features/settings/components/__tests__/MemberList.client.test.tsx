// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { saveMemberChanges } from '@/features/settings/services/members';
import { createInvite } from '@/features/settings/services/invites';
import { MemberList } from '../MemberList.client';

// メンバー管理のロールの出し分け（招待・削除・ロールの変更は管理者だけ）と、保存・招待で送る内容を確かめる。
// Supabase の読み取り・Server Action・ログイン中の人だけをモックし、下書きと差分の組み立ては実物を通す。

const mocks = vi.hoisted(() => ({
  profiles: [] as { id: string; fullName: string; email: string; role: string }[],
  currentProfile: null as null | { id: string; role: string },
  refresh: vi.fn(),
  invitesQueried: 0,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ order: async () => ({ data: mocks.profiles, error: null }) }) };
      }
      mocks.invitesQueried += 1;
      return {
        select: () => ({ is: () => ({ order: async () => ({ data: [], error: null }) }) }),
      };
    },
  }),
}));

vi.mock('@/features/settings/services/members', () => ({
  saveMemberChanges: vi.fn(),
}));

vi.mock('@/features/settings/services/invites', () => ({
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ profile: mocks.currentProfile, refresh: mocks.refresh }),
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

const roleSelect = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLSelectElement>(`select[aria-label="${name} のロール"]`);

describe('MemberList のロール', () => {
  let view: RenderResult | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveMemberChanges).mockResolvedValue({ ok: true, data: undefined });
    mocks.invitesQueried = 0;
    mocks.profiles = [
      { id: 'admin-1', fullName: '管理 一郎', email: 'admin@example.com', role: 'admin' },
      { id: 'member-1', fullName: '入力 花子', email: 'member@example.com', role: 'logger' },
      { id: 'viewer-1', fullName: '閲覧 次郎', email: 'viewer@example.com', role: 'viewer' },
    ];
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  const mount = async () => {
    view = render(<MemberList showToast={vi.fn()} />);
    await flush();
    return view.container;
  };

  it('メンバーには、ロールを表示するだけで、招待・変更・削除の操作を出さない', async () => {
    mocks.currentProfile = { id: 'member-1', role: 'logger' };
    const container = await mount();

    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(container.querySelectorAll('button[class*="text-danger"]')).toHaveLength(0);
    const rows = Array.from(container.querySelectorAll('tbody tr')).map(row => row.textContent);
    expect(rows[0]).toContain('管理者');
    // viewer も「メンバー」と表示する
    expect(rows[2]).toContain('メンバー');
    expect(container.textContent).toContain('メンバーの招待・削除・ロールの変更は、管理者のみできます。');
    expect(buttonByText(container, 'メンバーを招待')).toBeUndefined();
    // 招待中の一覧（招待リンクを含む）は RLS で管理者にしか返らないため、取得もしない
    expect(mocks.invitesQueried).toBe(0);
  });

  it('管理者が 1 人だけなら、2 人以上にすることを勧める', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    const container = await mount();
    expect(container.textContent).toContain('管理者を 2 人以上にしておくことを勧めます');
  });

  it('管理者がメンバーを管理者に変えて保存すると、変わったロールだけを送る', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    const container = await mount();

    const select = roleSelect(container, '入力 花子');
    expect(select).not.toBeNull();
    selectValue(select as HTMLSelectElement, 'admin');

    click(buttonByText(container, '変更を保存') as HTMLButtonElement);
    expect(container.textContent).toContain('ロールの変更 1 件を保存しますか？');
    click(buttonByText(container, '保存') as HTMLButtonElement);
    await flush();

    expect(saveMemberChanges).toHaveBeenCalledWith({
      removedMemberIds: [],
      roleChanges: [{ memberId: 'member-1', role: 'admin' }],
    });
  });

  it('自分をメンバーにする変更は、管理者でなくなることを確認で知らせ、保存後に自分の情報を取り直す', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    mocks.profiles[1].role = 'admin';
    const container = await mount();

    selectValue(roleSelect(container, '管理 一郎') as HTMLSelectElement, 'logger');
    click(buttonByText(container, '変更を保存') as HTMLButtonElement);
    expect(container.textContent).toContain('あなたは管理者でなくなり');
    click(buttonByText(container, '保存') as HTMLButtonElement);
    await flush();

    expect(saveMemberChanges).toHaveBeenCalledWith({
      removedMemberIds: [],
      roleChanges: [{ memberId: 'admin-1', role: 'logger' }],
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('管理者が 0 人になる下書きは保存させない', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    const container = await mount();

    selectValue(roleSelect(container, '管理 一郎') as HTMLSelectElement, 'logger');

    expect(container.textContent).toContain('管理者が 1 人もいなくなるため保存できません');
    expect((buttonByText(container, '変更を保存') as HTMLButtonElement).disabled).toBe(true);
  });

  it('管理者はロールを選んで招待でき、選んだロールを送る', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    vi.mocked(createInvite).mockResolvedValue({
      ok: true,
      data: {
        token: '11111111-1111-1111-1111-111111111111',
        email: 'new@example.com',
        expiresAt: '2026-11-01T00:00:00Z',
        emailStatus: 'skipped',
      },
    });
    const container = await mount();
    expect(mocks.invitesQueried).toBeGreaterThan(0);

    click(buttonByText(container, 'メンバーを招待') as HTMLButtonElement);
    const roleSelectInModal = container.querySelector<HTMLSelectElement>('#inviteRole');
    // 既定はメンバー
    expect(roleSelectInModal?.value).toBe('logger');
    setInputValue(container.querySelector('#inviteEmail') as HTMLInputElement, 'new@example.com');
    selectValue(roleSelectInModal as HTMLSelectElement, 'admin');
    click(buttonByText(container, '招待リンクを発行') as HTMLButtonElement);
    await flush();

    expect(createInvite).toHaveBeenCalledWith({ email: 'new@example.com', role: 'admin' });
  });

  it('組織に管理者が 1 人もいなければ、復旧の手順へ案内する（だれが見ても出す）', async () => {
    mocks.currentProfile = { id: 'member-1', role: 'logger' };
    mocks.profiles[0].role = 'logger';
    const container = await mount();
    expect(container.textContent).toContain('この組織には管理者がいません');
    const link = container.querySelector<HTMLAnchorElement>('a[href*="setup-guide.md#h-2-"]');
    expect(link).not.toBeNull();
  });
});
