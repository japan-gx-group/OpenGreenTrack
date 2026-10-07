// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, setInputValue, type RenderResult } from '@/lib/testing/render';
import type { Scope3MethodCategoryItem } from '../../services/scopeAnalysisService';
import { Scope3MethodPanel } from '../Scope3MethodPanel.client';

// Scope3MethodPanel の直接入力値モーダルのコンポーネントテスト。
// 排出量欄の IME 正規化（全角数字が無言で弾かれ何も入力できない）を中心に、
// 「画面に何が出て、onSaveDirect に何が渡るか」を検証する。
// ドリルダウン取得（getScope3CategoryDrilldown）はモーダル経路では呼ばれないためモック不要。

const ITEM: Scope3MethodCategoryItem = {
  categoryId: 1,
  name: '購入した製品・サービス',
  method: 'direct',
  directEmissions: null,
  directDataSourceNote: null,
  calculatedEmissions: 0,
  adoptedEmissions: 0,
};

const renderPanel = (onSaveDirect = vi.fn()) => {
  const result = render(
    <Scope3MethodPanel
      items={[ITEM]}
      fiscalYearId="fy2024"
      onSwitchMethod={vi.fn()}
      onSaveDirect={onSaveDirect}
    />,
  );
  return { ...result, onSaveDirect };
};

const openModal = (container: HTMLElement): HTMLInputElement => {
  const editButton = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === '直接入力値',
  );
  expect(editButton, '「直接入力値」ボタンが見つかりません').toBeDefined();
  act(() => {
    editButton!.click();
  });
  const input = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
  expect(input, '排出量入力欄が見つかりません').not.toBeNull();
  return input!;
};

const fireComposition = (input: HTMLInputElement, type: 'compositionstart' | 'compositionend'): void => {
  act(() => {
    input.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  });
};

const rejectedMessage = (container: HTMLElement) =>
  container.querySelector('[data-testid="direct-emissions-rejected"]');

let mounted: RenderResult | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('Scope3MethodPanel 直接入力値モーダルの排出量欄', () => {
  it('半角数字はそのまま受け付ける', () => {
    const result = renderPanel();
    mounted = result;
    const input = openModal(result.container);

    setInputValue(input, '1250.5');

    expect(input.value).toBe('1250.5');
    expect(rejectedMessage(result.container)).toBeNull();
  });

  it('IME 変換中は入力を巻き戻さず、確定時に全角数字を半角へ正規化する', () => {
    const result = renderPanel();
    mounted = result;
    const input = openModal(result.container);

    fireComposition(input, 'compositionstart');
    setInputValue(input, '１２５０．５');
    // 変換中は見たまま表示する（巻き戻すと composition が壊れて入力不能になる）。
    expect(input.value).toBe('１２５０．５');

    fireComposition(input, 'compositionend');
    expect(input.value).toBe('1250.5');
    expect(rejectedMessage(result.container)).toBeNull();
  });

  it('正規化しても数字にならない確定入力は直前の値に戻し、理由を表示する', () => {
    const result = renderPanel();
    mounted = result;
    const input = openModal(result.container);

    setInputValue(input, '125');

    fireComposition(input, 'compositionstart');
    setInputValue(input, '125あ');
    fireComposition(input, 'compositionend');

    expect(input.value).toBe('125');
    expect(rejectedMessage(result.container)?.textContent).toBe(
      '排出量は数字と小数点のみ入力できます。',
    );

    // 数字を入れ直すと案内は消える。
    setInputValue(input, '126');
    expect(rejectedMessage(result.container)).toBeNull();
  });

  it('IME 正規化で確定した値が onSaveDirect へ数値として渡る', async () => {
    const onSaveDirect = vi.fn().mockResolvedValue(undefined);
    const result = renderPanel(onSaveDirect);
    mounted = result;
    const input = openModal(result.container);

    fireComposition(input, 'compositionstart');
    setInputValue(input, '１２５０．５');
    fireComposition(input, 'compositionend');

    const saveButton = [...result.container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '保存する',
    );
    expect(saveButton, '「保存する」ボタンが見つかりません').toBeDefined();
    await act(async () => {
      saveButton!.form?.requestSubmit();
    });

    expect(onSaveDirect).toHaveBeenCalledWith(1, 1250.5, '');
  });
});
