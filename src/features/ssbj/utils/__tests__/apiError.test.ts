import { describe, expect, it } from 'vitest';
import { ssbjApiErrorMessage } from '../apiError';

describe('ssbjApiErrorMessage', () => {
  it('サーバの文が具体的なときは、そのまま出す', () => {
    expect(ssbjApiErrorMessage(409, { error: '他の変更と競合しました。画面を開き直してください' }, '保存版の作成に失敗しました'))
      .toBe('他の変更と競合しました。画面を開き直してください');
  });

  it('5xx の原因の分からない失敗（サーバの決まり文句・本文なし）には、サーバの問題であることと次の一手を添える', () => {
    const expected = 'プレビューの取得に失敗しました（サーバーで問題が起きました）。少し待ってから「読み直す」か画面を開き直してください。'
      + '続くときは管理者に連絡してください';
    expect(ssbjApiErrorMessage(500, { error: 'サーバー内部エラーが発生しました' }, 'プレビューの取得に失敗しました')).toBe(expected);
    expect(ssbjApiErrorMessage(500, null, 'プレビューの取得に失敗しました')).toBe(expected);
    expect(ssbjApiErrorMessage(503, null, 'プレビューの取得に失敗しました')).toBe(expected);
  });

  it('本文の無い 404 は「見つかりませんでした」、400 は入力を確かめる文にし、サーバの問題とは書かない', () => {
    const notFound = ssbjApiErrorMessage(404, null, 'プレビューの取得に失敗しました');
    expect(notFound).toBe('プレビューの取得に失敗しました。見つかりませんでした。削除されたか、開いている画面が古い可能性があります。一覧から開き直してください');
    const badRequest = ssbjApiErrorMessage(400, {}, '保存版の作成に失敗しました');
    expect(badRequest).toBe('保存版の作成に失敗しました。入力の内容を確かめてください（空の欄・字数・形式など）。直しても続くときは管理者に連絡してください');
    for (const message of [notFound, badRequest]) expect(message).not.toContain('サーバーで問題が起きました');
  });

  it('404・400 でもサーバの文が具体的なときは、そのまま出す', () => {
    expect(ssbjApiErrorMessage(404, { error: 'レポートが見つかりません' }, 'プレビューの取得に失敗しました')).toBe('レポートが見つかりません');
    expect(ssbjApiErrorMessage(400, { error: '版の指定が正しくありません' }, '保存版の作成に失敗しました')).toBe('版の指定が正しくありません');
  });

  it('通信できない・そのほかの 4xx は、サーバの問題とは書かずに次の一手を出す', () => {
    expect(ssbjApiErrorMessage(0, null, 'プレビューの取得に失敗しました'))
      .toBe('プレビューの取得に失敗しました（通信できませんでした）。ネットワークの接続を確かめてから、もう一度お試しください');
    expect(ssbjApiErrorMessage(409, null, '保存版の作成に失敗しました'))
      .toBe('保存版の作成に失敗しました。画面を開き直して、もう一度お試しください。続くときは管理者に連絡してください');
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
