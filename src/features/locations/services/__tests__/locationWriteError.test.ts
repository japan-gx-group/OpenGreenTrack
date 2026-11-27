// 拠点の書き込み（CSVインポートの一括登録・更新）で返る PostgREST / Postgres のエラーを、
// 行エラー欄にそのまま出せる日本語へ変換することを保証する。
// 英語の文面ではなく error.code で判定するので、ライブラリ更新で文面が変わっても結果は変わらない。
import { describe, expect, it } from 'vitest';
import { toLocationWriteErrorMessage } from '../locationWriteError';

const NO_ROWS = { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' };

describe('toLocationWriteErrorMessage', () => {
  it('更新で対象が0件（PGRST116）のとき、削除された可能性と再読み込みを案内する', () => {
    expect(toLocationWriteErrorMessage(NO_ROWS, 'update')).toBe(
      '更新対象の拠点が見つかりません。取込の確認後に削除された可能性があります。一覧を再読み込みし、プレビューを確認してから取り込み直してください',
    );
  });

  it('登録で PGRST116 が返ったとき、削除の案内はせず詳細つきの登録失敗として返す', () => {
    // insert で対象が消えることはない。削除の案内は誤りになる。
    expect(toLocationWriteErrorMessage(NO_ROWS, 'create')).toBe(
      '拠点の登録に失敗しました（詳細: Cannot coerce the result to a single JSON object）',
    );
  });

  it.each([
    ['PGRST301', 'JWT could not be decoded'],
    ['PGRST303', 'JWT expired'],
    ['42501', 'permission denied for table locations'],
  ])('ログイン切れを表すコード（%s）のとき、再ログインを案内する', (code, message) => {
    expect(toLocationWriteErrorMessage({ code, message }, 'update')).toBe(
      'ログイン情報が確認できませんでした。再度ログインしてから取り込み直してください',
    );
  });

  it.each([
    ['create', '拠点の登録に失敗しました（詳細: connection failure）'],
    ['update', '拠点の更新に失敗しました（詳細: connection failure）'],
  ] as const)('未知のコードのとき、%s の失敗として元のメッセージを詳細に添える', (action, expected) => {
    expect(toLocationWriteErrorMessage({ code: '08006', message: 'connection failure' }, action)).toBe(
      expected,
    );
  });

  it('エラーが null のとき、詳細を付けずに定型文を返す', () => {
    expect(toLocationWriteErrorMessage(null, 'create')).toBe('拠点の登録に失敗しました');
  });

  it('メッセージが空のとき、「詳細: 」だけの空の括弧を付けずに定型文を返す', () => {
    expect(toLocationWriteErrorMessage({ code: '', message: '' }, 'update')).toBe('拠点の更新に失敗しました');
  });
});
