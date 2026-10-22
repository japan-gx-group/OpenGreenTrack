// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { click, focusElement, keyDown, render, setInputValue } from '@/lib/testing/render';
import { SearchableSelect, type SearchableSelectOption } from '../SearchableSelect.client';

// SearchableSelect の基本挙動のテスト。
// 候補リストの開閉・絞り込み・選択コールバック・disabled を検証する。

beforeAll(() => {
  // jsdom は scrollIntoView（レイアウト依存 API）を実装していないため no-op で補う。
  // コンポーネントはハイライト行を可視範囲へ保つ目的でのみ使っており、挙動検証には影響しない。
  Element.prototype.scrollIntoView ??= () => {};
});

const options: SearchableSelectOption[] = [
  { value: 'tokyo', label: '東京本社' },
  { value: 'osaka', label: '大阪支社' },
  { value: 'nagoya', label: '名古屋営業所' },
];

const getInput = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]');
  expect(input).not.toBeNull();
  return input!;
};

const listedLabels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('[role="option"]')].map((item) => item.textContent ?? '');

// コンポーネントの枠外クリック検知は document の pointerdown リスナー。
// jsdom は PointerEvent 未実装のため、同名イベントを MouseEvent で発火する（ハンドラは target しか見ない）。
const pointerDownOutside = (): void => {
  act(() => {
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  });
};

describe('SearchableSelect', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('フォーカスで候補リストが開き、全候補を表示する', () => {
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={() => {}} />,
    );

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    focusElement(getInput(container));

    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(listedLabels(container)).toEqual(['東京本社', '大阪支社', '名古屋営業所']);
    unmount();
  });

  it('入力したキーワードで候補を絞り込み、0件時はメッセージを表示する', () => {
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={() => {}} />,
    );
    const input = getInput(container);
    focusElement(input);

    setInputValue(input, '大阪');
    expect(listedLabels(container)).toEqual(['大阪支社']);

    setInputValue(input, '存在しない拠点');
    expect(listedLabels(container)).toEqual([]);
    expect(container.textContent).toContain('該当する候補がありません');
    unmount();
  });

  it('候補のクリックで onChange が呼ばれ、リストが閉じる', () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={onChange} />,
    );
    focusElement(getInput(container));

    const osakaButton = [...container.querySelectorAll<HTMLButtonElement>('[role="option"] button')]
      .find((button) => button.textContent === '大阪支社');
    expect(osakaButton).toBeDefined();
    click(osakaButton!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('osaka');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    unmount();
  });

  it('↓キーと Enter でハイライト中の候補を選択できる', () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={onChange} />,
    );
    const input = getInput(container);
    focusElement(input);

    keyDown(input, 'ArrowDown'); // 先頭 → 2件目へ
    keyDown(input, 'Enter');

    expect(onChange).toHaveBeenCalledWith('osaka');
    unmount();
  });

  it('IME 変換確定の Enter（isComposing）では候補を選択しない', () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={onChange} />,
    );
    const input = getInput(container);
    focusElement(input);
    setInputValue(input, '東京');

    keyDown(input, 'Enter', { isComposing: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    unmount();
  });

  it('IME 変換確定直後の Enter（keyCode 229）では候補を選択しない', () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={onChange} />,
    );
    const input = getInput(container);
    focusElement(input);
    setInputValue(input, '東京');

    keyDown(input, 'Enter', { keyCode: 229 });

    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    unmount();
  });

  it('IME 変換取り消しの Escape（isComposing）では候補リストを閉じず、検索語も保持する', () => {
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={() => {}} />,
    );
    const input = getInput(container);
    focusElement(input);
    setInputValue(input, '東京');

    keyDown(input, 'Escape', { isComposing: true });

    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(input.value).toBe('東京');
    unmount();
  });

  it('Escape キーで候補リストが閉じる', () => {
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value={null} onChange={() => {}} />,
    );
    const input = getInput(container);
    focusElement(input);
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    keyDown(input, 'Escape');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    unmount();
  });

  it('選択中はクリアボタンが表示され、クリックで onChange(null) が呼ばれる', () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value="tokyo" onChange={onChange} />,
    );

    expect(getInput(container).value).toBe('東京本社');
    const clearButton = container.querySelector<HTMLButtonElement>('button[aria-label="選択を解除"]');
    expect(clearButton).not.toBeNull();
    click(clearButton!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    unmount();
  });

  it('検索語を残したまま枠外クリックで閉じると、onQueryChange("") の後に onSearchAbandoned が検索語付きで呼ばれる', () => {
    const onQueryChange = vi.fn();
    const onSearchAbandoned = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect
        id="location"
        options={options}
        value={null}
        onChange={() => {}}
        onQueryChange={onQueryChange}
        onSearchAbandoned={onSearchAbandoned}
      />,
    );
    const input = getInput(container);
    focusElement(input);
    setInputValue(input, '東京');

    pointerDownOutside();

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(onSearchAbandoned).toHaveBeenCalledTimes(1);
    expect(onSearchAbandoned).toHaveBeenCalledWith('東京');
    // 親は onQueryChange で警告を消し、onSearchAbandoned で出し直せる（この順序が契約）
    expect(onQueryChange).toHaveBeenLastCalledWith('');
    const lastQueryChangeOrder = onQueryChange.mock.invocationCallOrder.at(-1)!;
    const abandonedOrder = onSearchAbandoned.mock.invocationCallOrder[0]!;
    expect(lastQueryChangeOrder).toBeLessThan(abandonedOrder);
    unmount();
  });

  it('検索語が空のまま枠外クリックで閉じても onSearchAbandoned は呼ばれない', () => {
    const onSearchAbandoned = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect
        id="location"
        options={options}
        value={null}
        onChange={() => {}}
        onSearchAbandoned={onSearchAbandoned}
      />,
    );
    focusElement(getInput(container));

    pointerDownOutside();

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(onSearchAbandoned).not.toHaveBeenCalled();
    unmount();
  });

  it('検索語から候補を選択して閉じたときは onSearchAbandoned は呼ばれない', () => {
    const onSearchAbandoned = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect
        id="location"
        options={options}
        value={null}
        onChange={() => {}}
        onSearchAbandoned={onSearchAbandoned}
      />,
    );
    const input = getInput(container);
    focusElement(input);
    setInputValue(input, '大阪');

    const osakaButton = container.querySelector<HTMLButtonElement>('[role="option"] button');
    expect(osakaButton).not.toBeNull();
    click(osakaButton!);

    expect(onSearchAbandoned).not.toHaveBeenCalled();
    unmount();
  });

  it('検索語を残したまま Escape で閉じたときも onSearchAbandoned が呼ばれる', () => {
    const onSearchAbandoned = vi.fn();
    const { container, unmount } = render(
      <SearchableSelect
        id="location"
        options={options}
        value={null}
        onChange={() => {}}
        onSearchAbandoned={onSearchAbandoned}
      />,
    );
    const input = getInput(container);
    focusElement(input);
    setInputValue(input, '東京');

    keyDown(input, 'Escape');

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(onSearchAbandoned).toHaveBeenCalledTimes(1);
    expect(onSearchAbandoned).toHaveBeenCalledWith('東京');
    unmount();
  });

  it('disabled のとき入力欄が無効化され、クリアボタンも表示されない', () => {
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value="tokyo" onChange={() => {}} disabled />,
    );

    expect(getInput(container).disabled).toBe(true);
    expect(container.querySelector('button[aria-label="選択を解除"]')).toBeNull();
    unmount();
  });
});
