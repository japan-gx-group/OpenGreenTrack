// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { focusElement, keyDown, render, type RenderResult } from '@/lib/testing/render';
import { getMySsbjRole } from '@/features/ssbj/services/memberRoleService';
import { AppTopBar } from '../AppTopBar.client';

vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ profile: { organizationName: 'テスト組織' } }) }));
vi.mock('@/hooks/useAppRefresh', () => ({ useAppRefresh: () => ({ refreshToken: 0, requestRefresh: vi.fn() }) }));
vi.mock('../NotificationBell.client', () => ({ NotificationBell: () => null }));
vi.mock('@/features/ssbj/services/memberRoleService', () => ({ getMySsbjRole: vi.fn() }));

const reportPath = '/ssbj/5b1f0000-1111-4000-8000-000000000001';
let pathname: string;
let rendered: RenderResult;

const mount = (path: string) => {
  pathname = path;
  rendered = render(<AppTopBar />);
  return rendered.container.querySelector('nav')!;
};

const openTabMenu = (breadcrumb: HTMLElement, currentTab: string) => {
  const trigger = breadcrumb.querySelector<HTMLButtonElement>('button[aria-current="page"]')!;
  expect(trigger.textContent).toBe(currentTab);
  focusElement(trigger);
  keyDown(trigger, 'ArrowDown');
};

const menuLinks = () => Array.from(document.querySelectorAll('a[role="menuitem"]'))
  .map(link => [link.textContent, link.getAttribute('href')]);

afterEach(() => {
  rendered?.unmount();
  vi.resetAllMocks();
});

it('同じレポートのタブ・詳細・一覧へ移動でき、移動先のタブ名を表示する', async () => {
  vi.mocked(getMySsbjRole).mockResolvedValue('editor');
  const breadcrumb = mount(`${reportPath}/narratives`);
  await act(async () => {});
  expect(Array.from(breadcrumb.querySelectorAll('a'), link => link.getAttribute('href')))
    .toEqual(['/ssbj', reportPath]);

  openTabMenu(breadcrumb, '四本柱の文章');
  const risks = menuLinks().find(([label]) => label === 'リスク・機会');
  expect(risks).toEqual(['リスク・機会', `${reportPath}/risks`]);
  keyDown(document.activeElement!, 'Escape');
  await vi.waitFor(() => expect(document.activeElement).toBe(breadcrumb.querySelector('button')));
  pathname = risks![1]!;
  rendered.rerender(<AppTopBar />);
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe('リスク・機会');
});

it('閲覧者のプレビューでは保存履歴と出力だけを移動先として表示する', async () => {
  vi.mocked(getMySsbjRole).mockResolvedValue('viewer');
  const breadcrumb = mount(`${reportPath}/preview`);
  await act(async () => {});

  openTabMenu(breadcrumb, 'プレビュー');
  expect(menuLinks()).toEqual([['保存履歴と出力', `${reportPath}/versions`]]);
});

it('ロール取得中も取得失敗後も作業中の内容へのリンクを出さない', async () => {
  const { promise, reject } = Promise.withResolvers<never>();
  vi.mocked(getMySsbjRole).mockReturnValue(promise);
  const breadcrumb = mount(`${reportPath}/risks`);

  openTabMenu(breadcrumb, 'リスク・機会');
  const viewerLinks = [
    ['プレビュー', `${reportPath}/preview`],
    ['保存履歴と出力', `${reportPath}/versions`],
  ];
  expect(menuLinks()).toEqual(viewerLinks);

  await act(async () => reject(new Error('ロールの取得に失敗しました')));
  expect(menuLinks()).toEqual(viewerLinks);
});

it('同じレポートのタブへ移動したときも、移動前のロールを使わずに取得し直す', async () => {
  const { promise, resolve } = Promise.withResolvers<'viewer'>();
  vi.mocked(getMySsbjRole).mockResolvedValueOnce('editor').mockReturnValueOnce(promise);
  const breadcrumb = mount(`${reportPath}/narratives`);
  await act(async () => {});
  openTabMenu(breadcrumb, '四本柱の文章');
  expect(menuLinks()).toContainEqual(['リスク・機会', `${reportPath}/risks`]);

  pathname = `${reportPath}/versions`;
  rendered.rerender(<AppTopBar />);
  expect(getMySsbjRole).toHaveBeenCalledTimes(2);
  openTabMenu(breadcrumb, '保存履歴と出力');
  expect(menuLinks()).toEqual([['プレビュー', `${reportPath}/preview`]]);
  await act(async () => resolve('viewer'));
  expect(menuLinks()).toEqual([['プレビュー', `${reportPath}/preview`]]);
});

it('印刷ビューから同じレポートのプレビューへ戻れる', async () => {
  vi.mocked(getMySsbjRole).mockResolvedValue('viewer');
  const breadcrumb = mount(`${reportPath}/preview/print`);
  await act(async () => {});
  openTabMenu(breadcrumb, 'プレビュー');
  expect(menuLinks()).toContainEqual(['プレビュー', `${reportPath}/preview`]);
});

it('レポート詳細では一覧へのリンクを出し、タブ用のロールは取得しない', () => {
  const breadcrumb = mount(reportPath);
  expect(breadcrumb.querySelector('a')?.getAttribute('href')).toBe('/ssbj');
  expect(breadcrumb.querySelector('[aria-current="page"]')?.textContent).toBe('SSBJレポート詳細');
  expect(getMySsbjRole).not.toHaveBeenCalled();
});

it.each([
  ['/locations/example', '拠点詳細'],
  ['/ssbj/roles', 'SSBJ の権限'],
  ['/ssbj', 'SSBJレポート'],
  [`${reportPath}/unknown`, 'SSBJレポート詳細'],
])('%s では通常のパンくずを表示し、SSBJのロールは取得しない', (path, title) => {
  const breadcrumb = mount(path);
  expect(breadcrumb.textContent).toBe(`テスト組織${title}`);
  expect(breadcrumb.querySelector('a, button')).toBeNull();
  expect(getMySsbjRole).not.toHaveBeenCalled();
});
