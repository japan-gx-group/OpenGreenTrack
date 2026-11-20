// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, keyDown, render } from '@/lib/testing/render';
import { CsvImportConfirmModal, type CsvImportConfirmSummary } from '../CsvImportConfirmModal.client';

// 取込中にモーダルを閉じられると進捗表示が消え、裏で書き込みが続いたまま
// 同じファイルを再度取り込めてしまう。取込中は閉じる操作をすべて無視することを確認する。

const summary: CsvImportConfirmSummary = {
  fileName: 'locations.csv',
  createCount: 3,
  skipCount: 0,
  updates: [],
  errors: [],
};

const renderModal = (isRunning: boolean, onCancel: () => void) =>
  render(
    <CsvImportConfirmModal
      summary={summary}
      entityLabel="拠点"
      isRunning={isRunning}
      progress={isRunning ? { completed: 1, total: 3 } : undefined}
      onCancel={onCancel}
      onConfirm={vi.fn()}
    />,
  );

describe('CsvImportConfirmModal', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('取込中は Escape・オーバーレイ・閉じるボタンで閉じない', () => {
    const onCancel = vi.fn();
    const { container, unmount } = renderModal(true, onCancel);

    keyDown(document, 'Escape');
    click(container.querySelector('button[aria-label="閉じる"]')!);
    click(container.firstElementChild!);

    expect(onCancel).not.toHaveBeenCalled();
    unmount();
  });

  it('取込前は Escape・オーバーレイ・閉じるボタンで閉じられる', () => {
    const onCancel = vi.fn();
    const { container, unmount } = renderModal(false, onCancel);

    keyDown(document, 'Escape');
    click(container.querySelector('button[aria-label="閉じる"]')!);
    click(container.firstElementChild!);

    expect(onCancel).toHaveBeenCalledTimes(3);
    unmount();
  });
});
