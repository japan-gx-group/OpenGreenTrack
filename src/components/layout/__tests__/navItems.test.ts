import { describe, expect, it } from 'vitest';
import { getBreadcrumbs, getPageTitle } from '../navItems';

describe('getPageTitle', () => {
  it('SSBJ の権限の画面は、レポート詳細より先に一致させる', () => {
    expect(getPageTitle('/ssbj/roles')).toBe('SSBJ の権限');
    expect(getPageTitle('/ssbj/5b1f0000-1111-4000-8000-000000000001')).toBe('SSBJレポート詳細');
    expect(getPageTitle('/ssbj')).toBe('SSBJレポート');
  });
});

describe('getBreadcrumbs', () => {
  const id = '5b1f0000-1111-4000-8000-000000000001';

  it('SSBJ レポートの中の画面は「SSBJレポート › レポート詳細 › 画面名」にし、前の段から戻れる', () => {
    expect(getBreadcrumbs(`/ssbj/${id}/narratives`)).toEqual([
      { label: 'SSBJレポート', href: '/ssbj' },
      { label: 'レポート詳細', href: `/ssbj/${id}` },
      { label: 'ガバナンス・戦略等の文章' },
    ]);
    expect(getBreadcrumbs(`/ssbj/${id}/preview/print`).at(-1)).toEqual({ label: 'プレビュー' });
  });

  it('レポート詳細・権限の画面は 2 段、SSBJ 以外は画面名 1 段', () => {
    expect(getBreadcrumbs(`/ssbj/${id}`)).toEqual([{ label: 'SSBJレポート', href: '/ssbj' }, { label: 'レポート詳細' }]);
    expect(getBreadcrumbs('/ssbj/roles')).toEqual([{ label: 'SSBJレポート', href: '/ssbj' }, { label: 'SSBJ の権限' }]);
    expect(getBreadcrumbs('/ssbj')).toEqual([{ label: 'SSBJレポート' }]);
    expect(getBreadcrumbs('/settings/company')).toEqual([{ label: '企業・メンバー設定' }]);
  });
});
