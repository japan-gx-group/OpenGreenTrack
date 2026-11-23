import { describe, expect, it } from 'vitest';
import { ssbjApiErrorMessage } from '../apiError';

describe('ssbjApiErrorMessage', () => {
  it('サーバの文が具体的なときは、そのまま出す', () => {
    expect(ssbjApiErrorMessage(409, { error: '他の変更と競合しました。画面を開き直してください' }, '保存版の作成に失敗しました'))
      .toBe('他の変更と競合しました。画面を開き直してください');
  });

  it('原因の分からない失敗（サーバの決まり文句・本文なし・通信できない）には、次の一手を添える', () => {
    const expected = 'プレビューの取得に失敗しました（サーバーで問題が起きました）。少し待ってから「読み直す」か画面を開き直してください。'
      + '続くときは管理者に連絡してください';
    expect(ssbjApiErrorMessage(500, { error: 'サーバー内部エラーが発生しました' }, 'プレビューの取得に失敗しました')).toBe(expected);
    expect(ssbjApiErrorMessage(500, null, 'プレビューの取得に失敗しました')).toBe(expected);
    expect(ssbjApiErrorMessage(0, null, 'プレビューの取得に失敗しました')).toBe(expected);
  });

  it('ログイン切れと権限不足は、それぞれの次の一手を出す', () => {
    expect(ssbjApiErrorMessage(401, { error: '認証が必要です' }, '保存版の作成に失敗しました'))
      .toBe('保存版の作成に失敗しました。ログインの有効期限が切れています。ログインし直してから、もう一度お試しください');
    expect(ssbjApiErrorMessage(403, { error: 'この操作の権限がありません' }, 'プレビューの取得に失敗しました'))
      .toBe('この操作の権限がありません。必要なら、管理者に SSBJ のロールの確認を頼んでください');
    expect(ssbjApiErrorMessage(403, null, 'プレビューの取得に失敗しました'))
      .toBe('プレビューの取得に失敗しました。この操作の権限がありません。必要なら、管理者に SSBJ のロールの確認を頼んでください');
  });
});
