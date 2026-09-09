/**
 * UIコンポーネントテスト用の軽量レンダリングヘルパー。
 *
 * AGENTS.md の新規ライブラリ追加制約を踏まえ、@testing-library/react は導入せず
 * React 19 標準 API（react-dom/client の createRoot + react の act）だけで
 * コンポーネントを実 DOM（jsdom）へレンダリングする。
 *
 * 使い方:
 * - テストファイル先頭に `// @vitest-environment jsdom` の docblock を書く
 *   （vitest.config.ts のデフォルト environment は 'node' のため）
 * - `render(<Component />)` でマウントし、返り値の container を querySelector で検証する
 * - ユーザー操作は click / keyDown / focusElement / setInputValue で発火する
 *   （いずれも act でラップ済みなので、呼び出し後は再レンダリング反映済み）
 * - テスト末尾（または afterEach）で unmount() を呼び、effect の cleanup まで検証する
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  // React に「act を使うテスト環境である」ことを伝えるフラグ。
  // これが無いと act() 呼び出し時に警告が出る（React 19 の仕様）。
  // globalThis 経由で参照できるようにするため、ここは let/const ではなく var で宣言する。
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderResult {
  /** コンポーネントがマウントされた要素。querySelector で子要素を検証する */
  container: HTMLElement;
  /** 同じルートへ props を変えて再レンダリングする（状態は保持される） */
  rerender: (ui: ReactElement) => void;
  /** アンマウントして container を document から取り除く（effect cleanup の検証用） */
  unmount: () => void;
}

/**
 * コンポーネントを document.body 直下の新規 div へマウントする。
 * document.body へ実際に接続するのは、フォーカス移動や body スクロールロックなど
 * 「document に接続されていないと動かない」挙動を検証できるようにするため。
 */
export const render = (ui: ReactElement): RenderResult => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  act(() => {
    root.render(ui);
  });

  return {
    container,
    rerender: (next: ReactElement) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

/** 要素をクリックする（ネイティブの click イベントを発火） */
export const click = (element: Element): void => {
  act(() => {
    (element as HTMLElement).click();
  });
};

/**
 * keydown イベントを発火する。
 * target に document を渡せば、Modal の Escape ハンドラのような
 * document レベルのリスナーも検証できる。
 */
export const keyDown = (target: EventTarget, key: string, init: KeyboardEventInit = {}): void => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

/** 要素へフォーカスを移す（focus / focusin イベントが発火する） */
export const focusElement = (element: HTMLElement): void => {
  act(() => {
    element.focus();
  });
};

/**
 * 制御されたテキスト入力へ値を入力する。
 * React は input の value プロパティを追跡しているため、単純な `input.value = x` では
 * onChange が発火しない。ネイティブの setter で値を入れてから input イベントを流す
 * （@testing-library/user-event と同じ仕組み）。
 */
export const setInputValue = (input: HTMLInputElement, value: string): void => {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act(() => {
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
