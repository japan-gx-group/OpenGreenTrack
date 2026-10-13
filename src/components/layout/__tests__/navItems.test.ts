import { describe, expect, it } from 'vitest';
import { getPageTitle } from '../navItems';

describe('getPageTitle', () => {
  it('SSBJ の権限の画面は、レポート詳細より先に一致させる', () => {
    expect(getPageTitle('/ssbj/roles')).toBe('SSBJ の権限');
    expect(getPageTitle('/ssbj/5b1f0000-1111-4000-8000-000000000001')).toBe('SSBJレポート詳細');
    expect(getPageTitle('/ssbj')).toBe('SSBJレポート');
  });
});
