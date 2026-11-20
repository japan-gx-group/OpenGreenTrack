import { describe, expect, it } from 'vitest';
import { canWrite, isAdmin, isAssignableMemberRole, isMemberRole, memberRoleLabel } from '../role';

describe('canWrite', () => {
  it('admin と logger は書け、viewer は書けない', () => {
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('logger')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
  });

  it('ロールが取れていないときは書けない', () => {
    expect(canWrite(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});

describe('isAdmin', () => {
  it('admin だけを管理者とみなす', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('logger')).toBe(false);
    expect(isAdmin('viewer')).toBe(false);
  });

  it('ロールが取れていないときは管理者ではない', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('memberRoleLabel', () => {
  it('admin は「管理者」、logger と viewer はどちらも「メンバー」', () => {
    expect(memberRoleLabel('admin')).toBe('管理者');
    expect(memberRoleLabel('logger')).toBe('メンバー');
    expect(memberRoleLabel('viewer')).toBe('メンバー');
  });
});

describe('isMemberRole / isAssignableMemberRole', () => {
  it('DB に入りうる値は 3 つ、新しく書ける値は admin と logger の 2 つ', () => {
    expect(['admin', 'logger', 'viewer', 'member'].map(isMemberRole)).toEqual([true, true, true, false]);
    expect(['admin', 'logger', 'viewer', 'member'].map(isAssignableMemberRole)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
