// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ssbjPreviewScrollTop, ssbjScrollBehavior } from '../editorScroll';

describe('ssbjPreviewScrollTop', () => {
  const container = { top: 100, bottom: 600 };

  it('項目が枠の中に全部見えていれば動かさない', () => {
    expect(ssbjPreviewScrollTop(container, { top: 100, bottom: 600 }, 50)).toBeNull();
    expect(ssbjPreviewScrollTop(container, { top: 200, bottom: 300 }, 50)).toBeNull();
  });

  it('枠より下にある項目は、先頭が枠の上（余白つき）に来るまで動かす', () => {
    expect(ssbjPreviewScrollTop(container, { top: 900, bottom: 1000 }, 50)).toBe(50 + 800 - 16);
  });

  it('枠より上にある項目・一部だけ見えている項目も先頭へ。0 より上には動かさない', () => {
    expect(ssbjPreviewScrollTop(container, { top: 40, bottom: 140 }, 300)).toBe(300 - 60 - 16);
    expect(ssbjPreviewScrollTop(container, { top: 550, bottom: 700 }, 0)).toBe(450 - 16);
    expect(ssbjPreviewScrollTop(container, { top: 95, bottom: 200 }, 0)).toBe(0);
  });
});

describe('ssbjScrollBehavior', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  const mockReduce = (matches: boolean) => {
    window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
  };

  it('動きを減らす設定ならなめらかにしない', () => {
    mockReduce(true);
    expect(ssbjScrollBehavior()).toBe('auto');
  });

  it('設定が無ければなめらかに動かす', () => {
    mockReduce(false);
    expect(ssbjScrollBehavior()).toBe('smooth');
  });

  it('matchMedia が無い環境ではなめらかにしない', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(ssbjScrollBehavior()).toBe('auto');
  });
});
