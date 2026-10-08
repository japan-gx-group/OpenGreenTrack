import { describe, expect, it } from 'vitest';
import { memberName, type SsbjMember } from '../memberService';

const members: SsbjMember[] = [{ id: 'user-1', name: '環境 太郎', role: 'admin' }];

describe('memberName', () => {
  it('ID を表示名にする。見つからない利用者・操作者の無い記録はそれと分かる言葉にする', () => {
    expect(memberName(members, 'user-1')).toBe('環境 太郎');
    expect(memberName(members, 'user-x')).toBe('不明な利用者');
    expect(memberName(members, null)).toBe('システム');
  });
});
