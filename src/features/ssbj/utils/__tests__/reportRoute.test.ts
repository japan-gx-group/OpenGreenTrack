import { describe, expect, it } from 'vitest';
import { ssbjReportRoute } from '../reportRoute';

// レイアウトの下の選択中のセグメントから、今いる画面と印刷ビューかを決める。

describe('ssbjReportRoute', () => {
  it('詳細画面は空のパス、ほかの画面は 1 段目のパス', () => {
    expect(ssbjReportRoute([])).toEqual({ current: '', isPrint: false });
    expect(ssbjReportRoute(['__PAGE__'])).toEqual({ current: '', isPrint: false });
    expect(ssbjReportRoute(['narratives'])).toEqual({ current: 'narratives', isPrint: false });
    expect(ssbjReportRoute(['history', '__PAGE__'])).toEqual({ current: 'history', isPrint: false });
  });

  it('プレビューの印刷ビューを見分ける（ルートグループは除く）', () => {
    expect(ssbjReportRoute(['preview'])).toEqual({ current: 'preview', isPrint: false });
    expect(ssbjReportRoute(['preview', 'print'])).toEqual({ current: 'preview', isPrint: true });
    expect(ssbjReportRoute(['(group)', 'preview', 'print', '__PAGE__?{}'])).toEqual({ current: 'preview', isPrint: true });
  });
});
