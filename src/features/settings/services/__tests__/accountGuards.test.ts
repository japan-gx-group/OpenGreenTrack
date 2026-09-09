import { describe, expect, it } from 'vitest';
import { isLastMember } from '../accountGuards';

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
