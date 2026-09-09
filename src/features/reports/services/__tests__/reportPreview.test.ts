import { describe, expect, it } from 'vitest';
import { describeCalculationFreshness } from '../reportPreview';

// 「出力内容のプレビュー」の鮮度表示: 完了時だけ通常表示、それ以外は警告にする判断を守る。

describe('describeCalculationFreshness', () => {
  it('completed は通常表示（警告文なし）', () => {
    expect(describeCalculationFreshness('completed')).toEqual({ level: 'ok', statusLabel: '算定完了' });
  });

  it('pending は「算定実行中」の警告で、完了前の出力に注意を促す', () => {
    const freshness = describeCalculationFreshness('pending');
    expect(freshness.level).toBe('warning');
    expect(freshness.statusLabel).toBe('算定実行中');
    expect(freshness.message).toContain('反映されません');
  });

  it('failed は「算定失敗」の警告で、最後に集計できた内容が載ることを説明する', () => {
    const freshness = describeCalculationFreshness('failed');
    expect(freshness.level).toBe('warning');
    expect(freshness.statusLabel).toBe('算定失敗');
    expect(freshness.message).toContain('最後に集計できた内容');
  });

  it('バッチ記録が無い（undefined）場合は「算定記録なし」の警告にする', () => {
    const freshness = describeCalculationFreshness(undefined);
    expect(freshness.level).toBe('warning');
    expect(freshness.statusLabel).toBe('算定記録なし');
  });

  it('未知の状態は隠さず生の値を含めて警告する', () => {
    const freshness = describeCalculationFreshness('archived');
    expect(freshness.level).toBe('warning');
    expect(freshness.statusLabel).toContain('archived');
  });
});
