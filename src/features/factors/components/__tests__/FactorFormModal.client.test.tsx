// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyDown, render } from '@/lib/testing/render';
import type { FactorFormController } from '../../hooks/useFactorForm';
import { FactorFormModal } from '../FactorFormModal.client';

// 登録・編集フォームが共通シェル（FactorModal）に載っていて、
// 他のモーダルと同じ操作性（Escape・dialog セマンティクス・フォーカス移動）を持つことを検証する。
// フォームの入力・保存の流れは Factors.client.test.tsx が実物のフックを通して検証する。

const controller = (overrides: Partial<FactorFormController> = {}): FactorFormController => ({
  isModalOpen: true,
  editingFactorId: null,
  values: {
    name: '',
    energyType: '電気',
    scope: 'Scope 2',
    factorValue: 0,
    unit: 't-CO2/kWh',
    applicableYear: 2026,
    region: '全国',
    source: '自社設定',
    status: '有効',
    isCustom: true,
  },
  setValues: () => {},
  isSaving: false,
  openCreate: () => {},
  openEdit: () => {},
  close: () => {},
  submit: async () => {},
  ...overrides,
});

describe('FactorFormModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('isModalOpen=false のときは何も描画しない', () => {
    const { container, unmount } = render(
      <FactorFormModal form={controller({ isModalOpen: false })} availableYears={[2026]} />,
    );
    expect(container.firstChild).toBeNull();
    unmount();
  });

  it('dialog としてタイトルと紐づき、開くと閉じるボタンにフォーカスする', () => {
    const { container, unmount } = render(
      <FactorFormModal form={controller({ editingFactorId: 'f1' })} availableYears={[2026]} />,
    );

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const heading = container.querySelector('h3')!;
    expect(heading.textContent).toBe('排出係数の編集');
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(document.activeElement).toBe(container.querySelector('button[aria-label="閉じる"]'));
    unmount();
  });

  it('Escape で close が呼ばれ、IME 変換中の Escape では呼ばれない', () => {
    const close = vi.fn();
    const { unmount } = render(
      <FactorFormModal form={controller({ close })} availableYears={[2026]} />,
    );

    keyDown(document, 'Escape', { isComposing: true });
    expect(close).not.toHaveBeenCalled();

    keyDown(document, 'Escape');
    expect(close).toHaveBeenCalledTimes(1);
    unmount();
  });
});
