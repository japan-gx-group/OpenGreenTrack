// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import type { LocationFormController } from '../../hooks/useLocationForm';
import { LocationFormModal } from '../LocationFormModal.client';

// 拠点フォームの各ラベルが入力欄に結び付いているか（label の htmlFor と input / select の id の対応）を検証する。
// 結び付いていないとラベルをクリックしても入力欄にフォーカスが移らず、スクリーンリーダーにも項目名が読まれない。
describe('LocationFormModal ラベルの関連付け', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('拠点名称・地域区分・拠点種別・管理責任者名・稼働状況のラベルが htmlFor で対応する入力欄を指す', () => {
    const form = {
      isModalOpen: true, editingLocationId: null,
      values: { name: '', region: 'Kanto', type: 'office', person: '', status: 'active' },
      setValues: vi.fn(), isSaving: false, openAdd: vi.fn(), openEdit: vi.fn(), close: vi.fn(), submit: vi.fn(),
    } as unknown as LocationFormController;
    const { container, unmount } = render(
      <LocationFormModal form={form} returnFocusRef={{ current: null }} />,
    );

    const labels = Array.from(container.querySelectorAll('label'));
    expect(labels.map((label) => label.textContent?.replace(/\*/g, '').trim())).toEqual([
      '拠点名称', '地域区分', '拠点種別', '管理責任者名', '稼働状況',
    ]);
    for (const label of labels) {
      const name = label.textContent?.replace(/\*/g, '').trim();
      expect(label.htmlFor, `ラベル「${name}」に htmlFor が無い`).not.toBe('');
      const control = container.querySelector(`#${CSS.escape(label.htmlFor)}`);
      expect(
        control instanceof HTMLInputElement || control instanceof HTMLSelectElement,
        `ラベル「${name}」の参照先 #${label.htmlFor} が入力欄ではない`,
      ).toBe(true);
    }
    unmount();
  });

  it('保存中はキャンセルできない', () => {
    const form = {
      isModalOpen: true, editingLocationId: null,
      values: { name: '拠点', region: 'Kanto', type: 'office', person: '', status: 'active' },
      setValues: vi.fn(), isSaving: true, openAdd: vi.fn(), openEdit: vi.fn(), close: vi.fn(), submit: vi.fn(),
    } as unknown as LocationFormController;
    const { container, unmount } = render(
      <LocationFormModal form={form} returnFocusRef={{ current: null }} />,
    );

    expect(container.querySelector<HTMLButtonElement>('button[type="button"]:not([aria-label])')?.disabled).toBe(true);
    unmount();
  });
});
