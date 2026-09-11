import { describe, expect, it } from 'vitest';
import { isLocalOnlyInviteUrl } from '../inviteLink';

describe('isLocalOnlyInviteUrl', () => {
  it('localhost / ループバックIP のリンクは「このPCでしか開けない」と判定する', () => {
    expect(isLocalOnlyInviteUrl('http://localhost:3000/invite/abc')).toBe(true);
    expect(isLocalOnlyInviteUrl('http://127.0.0.1:3000/invite/abc')).toBe(true);
    expect(isLocalOnlyInviteUrl('http://127.1.2.3:3000/invite/abc')).toBe(true);
    expect(isLocalOnlyInviteUrl('http://[::1]:3000/invite/abc')).toBe(true);
    expect(isLocalOnlyInviteUrl('http://0.0.0.0:3000/invite/abc')).toBe(true);
    expect(isLocalOnlyInviteUrl('http://LOCALHOST:3000/invite/abc')).toBe(true);
    expect(isLocalOnlyInviteUrl('http://app.localhost:3000/invite/abc')).toBe(true);
  });

  it('他のPCから開けるホスト名のリンクは判定しない', () => {
    expect(isLocalOnlyInviteUrl('https://ghg.example.com/invite/abc')).toBe(false);
    expect(isLocalOnlyInviteUrl('http://192.168.10.5:3000/invite/abc')).toBe(false);
    // ホスト名の一部に localhost を含むだけの別ドメイン
    expect(isLocalOnlyInviteUrl('https://localhost.example.com/invite/abc')).toBe(false);
    expect(isLocalOnlyInviteUrl('https://mylocalhost/invite/abc')).toBe(false);
  });

  it('URL として解釈できない文字列は注意の対象にしない', () => {
    expect(isLocalOnlyInviteUrl('')).toBe(false);
    expect(isLocalOnlyInviteUrl('/invite/abc')).toBe(false);
  });
});
