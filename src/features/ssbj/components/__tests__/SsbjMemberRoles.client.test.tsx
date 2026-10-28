// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';

// SSBJ の権限の画面: 利用者ごとのロールの表示（管理者・既定の入力担当）、管理者だけが割り当てを変えられること（選んでから「変更を保存」で確定）、
// 変更の記録の表示を検証する（RLS は DB 側で確認する）。

vi.mock('../../services/memberService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberService')>()),
  listSsbjMembers: vi.fn(async () => [
    { id: 'user-admin', name: '環境 太郎', role: 'admin' },
    { id: 'user-editor', name: '算定 花子', role: 'logger' },
    { id: 'user-approver', name: '確認 三郎', role: 'logger' },
  ]),
}));

vi.mock('../../services/memberRoleService', async importOriginal => ({
  ...(await importOriginal<typeof import('../../services/memberRoleService')>()),
  listSsbjMemberRoles: vi.fn(async () => new Map([['user-approver', 'approver']])),
  listSsbjMemberRoleLogs: vi.fn(async () => [
    { id: 1, actorUserId: 'user-admin', action: 'create', userId: 'user-approver', role: 'approver', previousRole: null,
      createdAt: '2026-10-13T00:00:00.000Z' },
  ]),
  getMySsbjRole: vi.fn(async () => 'admin'),
  assignSsbjMemberRole: vi.fn(async () => undefined),
}));

import { assignSsbjMemberRole, getMySsbjRole, listSsbjMemberRoles } from '../../services/memberRoleService';
import { SsbjMemberRoles } from '../SsbjMemberRoles.client';

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

let rendered: RenderResult | null = null;

const renderScreen = async (): Promise<RenderResult> => {
  rendered = render(<SsbjMemberRoles />);
  await flushPromises();
  await flushPromises();
  return rendered;
};

const rowOf = (container: HTMLElement, name: string): HTMLElement => {
  const row = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="ssbj-member-role-row"]'))
    .find(element => element.textContent?.includes(name));
  if (!row) throw new Error(`行が見つかりません: ${name}`);
  return row;
};

const buttonOf = (root: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(element => element.textContent?.trim() === label);
  if (!button) throw new Error(`ボタンが見つかりません: ${label}`);
  return button;
};

const click = async (button: HTMLButtonElement): Promise<void> => {
  await act(async () => {
    button.click();
  });
  await flushPromises();
};

const chooseRole = async (container: HTMLElement, name: string, role: string): Promise<void> => {
  const select = rowOf(container, name).querySelector('select')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(select, role);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.clearAllMocks();
});

describe('SsbjMemberRoles', () => {
  it('OGT の管理者は管理者（変えられない）、割り当てが無い人は既定の入力担当、割り当てた人はそのロールで出す', async () => {
    const { container } = await renderScreen();
    expect(rowOf(container, '環境 太郎').textContent).toContain('管理者（OGT の管理者）');
    expect(rowOf(container, '環境 太郎').querySelector('select')).toBeNull();
    expect(rowOf(container, '算定 花子').querySelector('select')?.value).toBe('editor');
    expect(rowOf(container, '算定 花子').textContent).toContain('（既定）');
    expect(rowOf(container, '確認 三郎').querySelector('select')?.value).toBe('approver');
  });

  it('管理者はロールを選んでから「変更を保存」で確定する（確かめてから保存し、読み直す）', async () => {
    const { container } = await renderScreen();
    await chooseRole(container, '算定 花子', 'viewer');
    // 選んだだけでは保存しない（OGT のメンバー管理と同じ）。
    expect(assignSsbjMemberRole).not.toHaveBeenCalled();
    expect(rowOf(container, '算定 花子').textContent).toContain('未保存');

    await click(buttonOf(document.body, '変更を保存'));
    expect(document.querySelector('[data-testid="ssbj-member-role-changes"]')?.textContent).toContain('算定 花子：入力担当 → 閲覧者');
    expect(assignSsbjMemberRole).not.toHaveBeenCalled();

    await click(buttonOf(document.body, '保存する'));
    await flushPromises();
    expect(assignSsbjMemberRole).toHaveBeenCalledWith('user-editor', 'viewer');
    expect(listSsbjMemberRoles).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('SSBJ のロールの変更を保存しました');
  });

  it('キャンセルすると、選んだロールを元に戻して保存しない', async () => {
    const { container } = await renderScreen();
    await chooseRole(container, '確認 三郎', 'editor');
    await click(buttonOf(document.body, 'キャンセル'));
    expect(rowOf(container, '確認 三郎').querySelector('select')?.value).toBe('approver');
    expect(container.textContent).not.toContain('変更を保存');
    expect(assignSsbjMemberRole).not.toHaveBeenCalled();
  });

  it('途中で保存に失敗したら止め、保存済みの件数を伝える', async () => {
    vi.mocked(assignSsbjMemberRole).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SSBJ のロールの保存に失敗しました'));
    const { container } = await renderScreen();
    await chooseRole(container, '算定 花子', 'viewer');
    await chooseRole(container, '確認 三郎', 'editor');
    await click(buttonOf(document.body, '変更を保存'));
    await click(buttonOf(document.body, '保存する'));
    await flushPromises();
    expect(assignSsbjMemberRole).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('SSBJ のロールの保存に失敗しました（2 件のうち 1 件は保存済みです）');
    expect(container.textContent).not.toContain('SSBJ のロールの変更を保存しました');
  });

  it('管理者でない人にはロールを変えさせず、そのことを伝える', async () => {
    vi.mocked(getMySsbjRole).mockResolvedValueOnce('editor');
    const { container } = await renderScreen();
    expect(container.querySelectorAll('[data-testid="ssbj-member-role-row"] select')).toHaveLength(0);
    expect(rowOf(container, '確認 三郎').textContent).toContain('承認担当');
    expect(container.textContent).toContain('SSBJ のロールの変更は、管理者のみできます');
  });

  it('SSBJ のロールが SSBJ だけに効くことと、OGT の管理者を変える場所を伝える', async () => {
    const { container } = await renderScreen();
    const note = container.querySelector('[data-testid="ssbj-role-scope-note"]');
    expect(note?.textContent).toContain('OGT のデータ入力などはメンバーとして行えます');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/settings/company');
  });

  it('ロールの変更の記録を、誰が誰をどう変えたかの文で出す', async () => {
    const { container } = await renderScreen();
    const log = container.querySelector('[data-testid="ssbj-member-role-log"]');
    expect(log?.textContent).toContain('環境 太郎');
    expect(log?.textContent).toContain('確認 三郎 を承認担当にした（割り当て）');
  });
});
