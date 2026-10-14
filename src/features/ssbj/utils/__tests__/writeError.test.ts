import { describe, expect, it } from 'vitest';
import { SSBJ_LOCKED_MESSAGE, SSBJ_LOCKED_SQLSTATE, ssbjWriteErrorMessage } from '../writeError';

describe('ssbjWriteErrorMessage', () => {
  it('承認済みで DB に止められたときは、理由と次の手順を返す', () => {
    expect(ssbjWriteErrorMessage({ code: SSBJ_LOCKED_SQLSTATE }, '保存に失敗しました')).toBe(SSBJ_LOCKED_MESSAGE);
    expect(SSBJ_LOCKED_MESSAGE).toContain('差戻して');
  });

  it('それ以外は呼び出し元のメッセージ', () => {
    expect(ssbjWriteErrorMessage({ code: '23505' }, '保存に失敗しました')).toBe('保存に失敗しました');
    expect(ssbjWriteErrorMessage(null, '保存に失敗しました')).toBe('保存に失敗しました');
  });
});

describe('ssbjWriteErrorMessage（SSBJ のロール）', () => {
  it('RLS の拒否（42501）は、入力担当か管理者だけが変えられることを伝える', async () => {
    const { ssbjWriteErrorMessage } = await import('../writeError');
    expect(ssbjWriteErrorMessage({ code: '42501' }, '保存に失敗しました'))
      .toBe('この操作の権限がありません。SSBJ のレポートの内容を変えられるのは、入力担当か管理者だけです');
    expect(ssbjWriteErrorMessage({ code: 'XX000' }, '保存に失敗しました')).toBe('保存に失敗しました');
  });
});
