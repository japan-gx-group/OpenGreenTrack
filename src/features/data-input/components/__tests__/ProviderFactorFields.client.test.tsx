// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { focusElement, render, setInputValue } from '@/lib/testing/render';
import type { ProviderOption } from '../../services/providerOptions';
import type { ProviderSelection } from '../../services/entryFactorSelection';
import { ProviderFactorFields, type ProviderFactorFieldsProps } from '../ProviderFactorFields.client';

// 供給事業者コンボの「検索したのに選択されずに終わった」警告のテスト。
// 未選択のまま離脱すると全国の代替値で算定されるため、その場限りの警告で知らせる。

beforeAll(() => {
  // jsdom は scrollIntoView（レイアウト依存 API）を実装していないため no-op で補う。
  Element.prototype.scrollIntoView ??= () => {};
});

const providerOptions: ProviderOption[] = [
  {
    value: '東京電力エナジーパートナー',
    label: '東京電力エナジーパートナー（事業者コード: A00001）',
    searchText: '東京電力エナジーパートナー A00001',
  },
];

const unselected: ProviderSelection = { factorType: 'adjusted', providerName: null, menuName: null };

const baseProps: ProviderFactorFieldsProps = {
  providerOptions,
  menuOptions: [],
  selection: unselected,
  providerFactor: null,
  isLoadingProviders: false,
  providerLoadFailed: false,
  onRetryProviders: () => {},
  onFactorTypeChange: () => {},
  onProviderChange: () => {},
  onMenuChange: () => {},
};

const getProviderInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>('#manual-provider-select');
  expect(input).not.toBeNull();
  return input!;
};

// SearchableSelect の枠外クリック検知は document の pointerdown リスナー。
// jsdom は PointerEvent 未実装のため、同名イベントを MouseEvent で発火する。
const pointerDownOutside = (): void => {
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
};

const WARNING_FRAGMENT = '全国の代替値で算定されます';

describe('ProviderFactorFields', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('未選択のまま検索語を残して枠外クリックすると警告が出て、再フォーカスで消える', () => {
    const { container, unmount } = render(<ProviderFactorFields {...baseProps} />);
    const input = getProviderInput(container);

    expect(container.textContent).not.toContain(WARNING_FRAGMENT);
    focusElement(input);
    setInputValue(input, '東京');
    pointerDownOutside();

    expect(container.textContent).toContain('「東京」は確定されていません');
    expect(container.textContent).toContain(WARNING_FRAGMENT);
    const warning = container.querySelector('[role="status"]');
    expect(warning?.getAttribute('aria-live')).toBe('polite');

    // 再フォーカス（検索のやり直し）で揮発する。
    // jsdom では dispatchEvent の pointerdown でフォーカスが移らないため、実ブラウザの
    // 「枠外クリックでフォーカスが外れる」状態を blur で再現してから focus し直す。
    act(() => {
      input.blur();
    });
    focusElement(input);
    expect(container.textContent).not.toContain(WARNING_FRAGMENT);
    unmount();
  });

  it('候補の選択で警告が消える', () => {
    const { container, unmount } = render(<ProviderFactorFields {...baseProps} />);
    const input = getProviderInput(container);

    focusElement(input);
    setInputValue(input, '東京');
    pointerDownOutside();
    expect(container.textContent).toContain(WARNING_FRAGMENT);

    focusElement(input);
    setInputValue(input, '東京');
    const optionButton = container.querySelector<HTMLButtonElement>('[role="option"] button');
    expect(optionButton).not.toBeNull();
    act(() => {
      optionButton!.click();
    });
    expect(container.textContent).not.toContain(WARNING_FRAGMENT);
    unmount();
  });

  it('選択済みの事業者がいる場合は、検索を離脱しても警告を出さない（選択が保たれるため）', () => {
    const selected: ProviderSelection = {
      factorType: 'adjusted',
      providerName: '東京電力エナジーパートナー',
      menuName: null,
    };
    const { container, unmount } = render(
      <ProviderFactorFields {...baseProps} selection={selected} />,
    );
    const input = getProviderInput(container);

    focusElement(input);
    setInputValue(input, '東京');
    pointerDownOutside();

    expect(container.textContent).not.toContain(WARNING_FRAGMENT);
    unmount();
  });
});
