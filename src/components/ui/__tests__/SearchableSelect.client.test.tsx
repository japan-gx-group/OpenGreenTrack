// @vitest-environment jsdom
import React from 'react';
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

  it('disabled のとき入力欄が無効化され、クリアボタンも表示されない', () => {
    const { container, unmount } = render(
      <SearchableSelect id="location" options={options} value="tokyo" onChange={() => {}} disabled />,
    );

    expect(getInput(container).disabled).toBe(true);
    expect(container.querySelector('button[aria-label="選択を解除"]')).toBeNull();
    unmount();
  });
});
