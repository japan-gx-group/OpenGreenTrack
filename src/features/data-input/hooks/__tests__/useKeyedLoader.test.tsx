// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { useKeyedLoader } from '../useKeyedLoader';

// useKeyedLoader の回帰テスト。
// 「取得済みキーへ戻ったときにローディングが固着しない」「同一キーを二重に取得しない」
// 「失敗もキーごとに保持して再取得ループにならない」を固定する。

type Deferred = { promise: Promise<string>; resolve: (value: string) => void; reject: (error: Error) => void };

const deferred = (): Deferred => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const Probe = ({ keyValue, load }: { keyValue: string | null; load: (key: string) => Promise<string> }) => {
  const { state, isLoading } = useKeyedLoader(keyValue, load, 'ERR');
  return (
    <div
      data-testid="probe"
      data-loading={String(isLoading)}
      data-status={state?.status ?? 'none'}
      data-value={state?.status === 'ready' ? state.value : ''}
      data-message={state?.status === 'error' ? state.message : ''}
    />
  );
};

const probeOf = (container: HTMLElement): HTMLElement => container.querySelector('[data-testid="probe"]')!;

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useKeyedLoader', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('キーごとに 1 回取得し、結果を ready としてキャッシュする', async () => {
    const pending = new Map<string, Deferred>();
    const load = vi.fn((key: string) => {
      const d = deferred();
      pending.set(key, d);
      return d.promise;
    });
    const { container, unmount } = render(<Probe keyValue="A" load={load} />);

    expect(probeOf(container).dataset.loading).toBe('true');
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.get('A')!.resolve('value-A');
    });
    expect(probeOf(container).dataset.loading).toBe('false');
    expect(probeOf(container).dataset.value).toBe('value-A');
    unmount();
  });

  it('取得済み A → 取得中 B → A に戻すと A は即座に非ローディングで、B の完了後も固着しない', async () => {
    const pending = new Map<string, Deferred>();
    const load = vi.fn((key: string) => {
      const d = deferred();
      pending.set(key, d);
      return d.promise;
    });
    const { container, rerender, unmount } = render(<Probe keyValue="A" load={load} />);
    await act(async () => {
      pending.get('A')!.resolve('value-A');
    });

    rerender(<Probe keyValue="B" load={load} />);
    expect(probeOf(container).dataset.loading).toBe('true');
    expect(load).toHaveBeenCalledTimes(2);

    rerender(<Probe keyValue="A" load={load} />);
    expect(probeOf(container).dataset.loading).toBe('false');
    expect(probeOf(container).dataset.value).toBe('value-A');

    // B の結果は後から静かにキャッシュされ、A の表示は変わらない
    await act(async () => {
      pending.get('B')!.resolve('value-B');
    });
    expect(probeOf(container).dataset.loading).toBe('false');
    expect(probeOf(container).dataset.value).toBe('value-A');

    rerender(<Probe keyValue="B" load={load} />);
    expect(probeOf(container).dataset.value).toBe('value-B');
    // A・B とも再取得は走らない
    expect(load).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('失敗はキーごとに error として保持し、同じキーを再取得しない', async () => {
    const pending = new Map<string, Deferred>();
    const load = vi.fn((key: string) => {
      const d = deferred();
      pending.set(key, d);
      return d.promise;
    });
    const { container, rerender, unmount } = render(<Probe keyValue="A" load={load} />);
    await act(async () => {
      pending.get('A')!.reject(new Error('boom'));
    });
    await flush();

    expect(probeOf(container).dataset.loading).toBe('false');
    expect(probeOf(container).dataset.status).toBe('error');
    expect(probeOf(container).dataset.message).toBe('ERR');

    rerender(<Probe keyValue="A" load={load} />);
    expect(load).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('key が null のときは取得せず、非ローディングになる', () => {
    const load = vi.fn(() => Promise.resolve('x'));
    const { container, unmount } = render(<Probe keyValue={null} load={load} />);
    expect(probeOf(container).dataset.loading).toBe('false');
    expect(probeOf(container).dataset.status).toBe('none');
    expect(load).not.toHaveBeenCalled();
    unmount();
  });

  it('同一キーの effect が再実行されても in-flight 中は二重に取得しない', async () => {
    const pending = new Map<string, Deferred>();
    const load = vi.fn((key: string) => {
      const d = deferred();
      pending.set(key, d);
      return d.promise;
    });
    const { rerender, unmount } = render(<Probe keyValue="A" load={load} />);
    rerender(<Probe keyValue="A" load={load} />);
    rerender(<Probe keyValue="A" load={load} />);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.get('A')!.resolve('value-A');
    });
    unmount();
  });
});
