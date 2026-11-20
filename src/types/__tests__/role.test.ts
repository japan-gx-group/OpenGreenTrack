import { describe, expect, it } from 'vitest';
import { canWrite, isAdmin, isAssignableMemberRole, isMemberRole, memberRoleLabel } from '../role';

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

describe('canWrite', () => {
  it('管理者とメンバーは書け、閲覧者は書けない', () => {
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('logger')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
  });

  it('ロールが取れていないときは書けない側に倒す', () => {
    expect(canWrite(null)).toBe(false);
    expect(canWrite(undefined)).toBe(false);
  });
});

describe('memberRoleLabel', () => {
  it('admin は「管理者」、logger は「メンバー」、viewer は「閲覧者」', () => {
    expect(memberRoleLabel('admin')).toBe('管理者');
    expect(memberRoleLabel('logger')).toBe('メンバー');
    expect(memberRoleLabel('viewer')).toBe('閲覧者');
  });
});

describe('isMemberRole / isAssignableMemberRole', () => {
  it('DB に入りうる値も、招待・ロールの変更で書ける値も admin・logger・viewer の 3 つ', () => {
    expect(['admin', 'logger', 'viewer', 'member'].map(isMemberRole)).toEqual([true, true, true, false]);
    expect(['admin', 'logger', 'viewer', 'member'].map(isAssignableMemberRole)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});
