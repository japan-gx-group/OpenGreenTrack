// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { CompanyInfo } from '../CompanyInfo.client';

// 企業情報の編集は管理者だけに出す（保存は RLS でも管理者に限られる）ことを確かめる。

const mocks = vi.hoisted(() => ({
  currentProfile: null as null | { id: string; role: string },
}));

vi.mock('../../services/organizationService', () => ({
  getOrganization: vi.fn(async () => ({
    id: 'org-1',
    name: '株式会社テスト',
    corporateNumber: '',
    industrySector: '',
    address: '',
    envManagerName: '',
    fiscalYearStartMonth: 4,
  })),
  updateOrganization: vi.fn(),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ profile: mocks.currentProfile }),
}));

const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text);

describe('CompanyInfo の出し分け', () => {
  let view: RenderResult | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('メンバーには編集ボタンを出さず、管理者のみ変更できることを示す', async () => {
    mocks.currentProfile = { id: 'member-1', role: 'logger' };
    view = render(<CompanyInfo showToast={vi.fn()} />);
    await flush();
    expect(view.container.textContent).toContain('株式会社テスト');
    expect(buttonByText(view.container, '編集')).toBeUndefined();
    expect(view.container.textContent).toContain('管理者のみ変更できます');
  });

  it('管理者には編集ボタンを出す', async () => {
    mocks.currentProfile = { id: 'admin-1', role: 'admin' };
    view = render(<CompanyInfo showToast={vi.fn()} />);
    await flush();
    expect(buttonByText(view.container, '編集')).toBeDefined();
    expect(view.container.textContent).not.toContain('管理者のみ変更できます');
  });
});
