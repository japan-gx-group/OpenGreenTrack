// @vitest-environment jsdom
import React, { act } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { writeConvertPreference } from '../../services/convertPreference';
import { useConvertPreference } from '../useConvertPreference';

// 「WebP に変換して容量を減らす」の選択: 同じ画面の帳票の欄と請求書のカードで共有し、このブラウザに覚える。

const KEY = 'ogt.activityEvidence.convertToWebp';

const Toggle = ({ name }: { name: string }) => {
  const { convertToWebp, setConvertToWebp } = useConvertPreference();
  return (
    <button type="button" data-name={name} aria-pressed={convertToWebp} onClick={() => setConvertToWebp(!convertToWebp)}>
      {name}
    </button>
  );
};

const toggle = (name: string) => document.body.querySelector<HTMLButtonElement>(`button[data-name="${name}"]`)!;
const pressed = (name: string) => toggle(name).getAttribute('aria-pressed');

let view: RenderResult | null = null;

describe('useConvertPreference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.restoreAllMocks();
    // 覚えられなかったときに持った選択を消す（書き込めれば持たない）
    writeConvertPreference(false);
    window.localStorage.clear();
  });

  it('同じ画面の片方で切り替えると、もう片方にも反映し、このブラウザに覚える', () => {
    view = render(
      <>
        <Toggle name="form" />
        <Toggle name="card" />
      </>,
    );
    expect([pressed('form'), pressed('card')]).toEqual(['false', 'false']);

    click(toggle('card'));
    expect([pressed('form'), pressed('card')]).toEqual(['true', 'true']);
    expect(window.localStorage.getItem(KEY)).toBe('true');

    click(toggle('form'));
    expect([pressed('form'), pressed('card')]).toEqual(['false', 'false']);
    expect(window.localStorage.getItem(KEY)).toBe('false');
  });

  it('覚えておいた選択で開き、別のタブで変えたときも反映する', () => {
    window.localStorage.setItem(KEY, 'true');
    view = render(<Toggle name="form" />);
    expect(pressed('form')).toBe('true');

    act(() => {
      window.localStorage.setItem(KEY, 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    expect(pressed('form')).toBe('false');
  });

  it('覚えられない環境でも、画面を開いている間は切り替えられる', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    view = render(
      <>
        <Toggle name="form" />
        <Toggle name="card" />
      </>,
    );
    click(toggle('form'));
    expect([pressed('form'), pressed('card')]).toEqual(['true', 'true']);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('サーバの描画では「変換しない」として描く（覚えておいた選択はブラウザで合わせ直す）', () => {
    window.localStorage.setItem(KEY, 'true');
    expect(renderToString(<Toggle name="form" />)).toContain('aria-pressed="false"');
  });
});
