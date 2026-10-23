import { describe, expect, it } from 'vitest';
import { LAST_ADMIN_MESSAGE, planMemberChanges, type CurrentMember } from '../memberChangePlan';

const members: CurrentMember[] = [
  { id: 'admin-1', role: 'admin' },
  { id: 'member-1', role: 'logger' },
  { id: 'viewer-1', role: 'viewer' },
];

describe('planMemberChanges', () => {
  it('反映の順番を「管理者への昇格 → メンバーへの降格 → 削除」に分ける', () => {
    const result = planMemberChanges(
      members,
      {
        removedMemberIds: ['viewer-1'],
        roleChanges: [
          { memberId: 'admin-1', role: 'logger' },
          { memberId: 'member-1', role: 'admin' },
        ],
      },
      'admin-1',
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        promotions: [{ memberId: 'member-1', role: 'admin' }],
        demotions: [{ memberId: 'admin-1', role: 'logger' }],
        removals: [{ memberId: 'viewer-1', role: 'viewer' }],
      },
    });
  });

  it('管理者かどうかが変わらない変更（viewer → logger など）は反映しない', () => {
    const result = planMemberChanges(
      members,
      {
        removedMemberIds: [],
        roleChanges: [
          { memberId: 'viewer-1', role: 'logger' },
          { memberId: 'admin-1', role: 'admin' },
        ],
      },
      'admin-1',
    );
    expect(result).toEqual({ ok: true, plan: { promotions: [], demotions: [], removals: [] } });
  });

  it('すべて反映すると管理者が 0 人になる変更は断る（降格）', () => {
    const result = planMemberChanges(
      members,
      { removedMemberIds: [], roleChanges: [{ memberId: 'admin-1', role: 'logger' }] },
      'admin-1',
    );
    expect(result).toEqual({ ok: false, error: LAST_ADMIN_MESSAGE });
  });

  it('すべて反映すると管理者が 0 人になる変更は断る（ほかの管理者の削除と自分の降格）', () => {
    const twoAdmins: CurrentMember[] = [...members, { id: 'admin-2', role: 'admin' }];
    const result = planMemberChanges(
      twoAdmins,
      { removedMemberIds: ['admin-2'], roleChanges: [{ memberId: 'admin-1', role: 'logger' }] },
      'admin-1',
    );
    expect(result).toEqual({ ok: false, error: LAST_ADMIN_MESSAGE });
  });

  it('自分を削除する変更は断る', () => {
    const result = planMemberChanges(members, { removedMemberIds: ['admin-1'] }, 'admin-1');
    expect(result).toEqual({ ok: false, error: '自分自身の削除はできません' });
  });

  it('組織にいないメンバーを含む変更は断る', () => {
    expect(planMemberChanges(members, { removedMemberIds: ['other-org'] }, 'admin-1')).toEqual({
      ok: false,
      error: '組織に存在しないメンバーが含まれています',
    });
    expect(
      planMemberChanges(
        members,
        { removedMemberIds: [], roleChanges: [{ memberId: 'other-org', role: 'admin' }] },
        'admin-1',
      ),
    ).toEqual({ ok: false, error: '組織に存在しないメンバーが含まれています' });
  });

  it('同じメンバーへの変更が重なる入力は断る', () => {
    const result = planMemberChanges(
      members,
      { removedMemberIds: ['member-1'], roleChanges: [{ memberId: 'member-1', role: 'admin' }] },
      'admin-1',
    );
    expect(result).toEqual({ ok: false, error: '同じメンバーへの変更が重複しています' });
  });

  it('書けないロール（viewer）や形の崩れた入力は断る', () => {
    const viewer = planMemberChanges(
      members,
      // Server Action はブラウザから任意の値で呼べるため、型の外の値も確かめる
      { removedMemberIds: [], roleChanges: [{ memberId: 'member-1', role: 'viewer' as never }] },
      'admin-1',
    );
    expect(viewer).toEqual({ ok: false, error: '変更内容が正しくありません' });

    const broken = planMemberChanges(
      members,
      { removedMemberIds: 'member-1' as never },
      'admin-1',
    );
    expect(broken).toEqual({ ok: false, error: '変更内容が正しくありません' });
  });
});
