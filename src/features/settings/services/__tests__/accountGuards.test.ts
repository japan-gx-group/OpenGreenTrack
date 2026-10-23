import { describe, expect, it } from 'vitest';
import { isLastAdmin, isLastMember } from '../accountGuards';

describe('isLastMember', () => {
  it('メンバーが1人だけなら削除を拒否する（true）', () => {
    expect(isLastMember(1)).toBe(true);
  });

  it('メンバーが2人以上なら削除を許可する（false）', () => {
    expect(isLastMember(2)).toBe(false);
  });

  it('想定外にメンバー数が0でも安全側で拒否する（true）', () => {
    expect(isLastMember(0)).toBe(true);
  });
});

describe('isLastAdmin', () => {
  it('管理者が自分 1 人だけなら削除を拒否する（true）', () => {
    expect(isLastAdmin('admin', 1)).toBe(true);
  });

  it('ほかにも管理者がいれば削除を許可する（false）', () => {
    expect(isLastAdmin('admin', 2)).toBe(false);
  });

  it('メンバー（logger・viewer）は管理者の人数にかかわらず許可する（false）', () => {
    expect(isLastAdmin('logger', 1)).toBe(false);
    expect(isLastAdmin('viewer', 0)).toBe(false);
  });

  it('想定外に管理者が 0 人と数えられても、管理者なら安全側で拒否する（true）', () => {
    expect(isLastAdmin('admin', 0)).toBe(true);
  });
});
