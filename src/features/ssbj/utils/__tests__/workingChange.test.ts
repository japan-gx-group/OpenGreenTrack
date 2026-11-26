// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifySsbjWorkingChanged, onSsbjWorkingChanged } from '../workingChange';

// 作業中の内容が書き換わったことの知らせ: 開いているレポートの知らせだけを受け、やめたら受けない。

const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); });

describe('notifySsbjWorkingChanged / onSsbjWorkingChanged', () => {
  it('同じレポートの知らせと、レポートの分からない知らせを受ける。別のレポートの知らせは受けない', () => {
    const handler = vi.fn();
    stops.push(onSsbjWorkingChanged('report-1', handler));
    notifySsbjWorkingChanged('report-1');
    notifySsbjWorkingChanged();
    notifySsbjWorkingChanged('report-2');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('やめた後は受けない', () => {
    const handler = vi.fn();
    const stop = onSsbjWorkingChanged('report-1', handler);
    stop();
    notifySsbjWorkingChanged('report-1');
    expect(handler).not.toHaveBeenCalled();
  });
});
