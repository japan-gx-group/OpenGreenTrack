import { describe, expect, it } from 'vitest';
import { AI_PURPOSES, DEFAULT_MAX_INPUT_BYTES, findAiPurpose } from '../purposes';

describe('findAiPurpose', () => {
  it('登録していない用途は undefined（Object の組み込みの名前も用途として扱わない）', () => {
    expect(findAiPurpose('invoice_reading_not_registered')).toBeUndefined();
    expect(findAiPurpose('toString')).toBeUndefined();
    expect(findAiPurpose('__proto__')).toBeUndefined();
  });

  // 請求書はファイルだけ、係数の判定は文字だけを送る（判定に請求書のファイルを送り直さない）。
  it('請求書の読取りはファイルだけ、係数の判定は文字だけを送れる', () => {
    expect(findAiPurpose('invoice_reading')?.inputs).toEqual(['pdf', 'image']);
    expect(findAiPurpose('invoice_factor_matching')?.inputs).toEqual(['text']);
  });

  it('登録済みの用途は、送れる量が既定の上限（Vercel の本文の上限に収まる 4MB）以下', () => {
    for (const purpose of Object.values(AI_PURPOSES)) {
      expect((purpose as { maxInputBytes: number }).maxInputBytes).toBeLessThanOrEqual(DEFAULT_MAX_INPUT_BYTES);
    }
  });
});
