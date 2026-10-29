// @vitest-environment jsdom
import React, { act, type FormEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/lib/testing/render';
import { addLocation } from '../../services/locationService';
import type { LocationRecord } from '../../types';
import { useLocationForm, type LocationFormController } from '../useLocationForm';

// 拠点フォームの保存: 保存ボタンを続けて押しても 1 回だけ保存する。保存中は閉じる操作を受け付けず、
// 保存に失敗しても入力を残す。保存に成功したら閉じる。

vi.mock('../../services/locationService', () => ({
  addLocation: vi.fn(),
  updateLocation: vi.fn(),
}));

const SAVED: LocationRecord = {
  id: 'loc-new',
  name: '横浜スマートセンター',
  region: 'Kanto',
  type: 'office',
  person: '',
  status: 'active',
};

let form: LocationFormController;
// レンダリング中にモジュール変数へ直接代入すると react-hooks/globals に弾かれるため、関数を経由して受け取る。
const capture = (value: LocationFormController) => { form = value; };

const Probe = ({ showToast }: { showToast: () => void }) => {
  capture(useLocationForm(vi.fn(), showToast));
  return null;
};

const submitEvent = () => ({ preventDefault: () => {} }) as FormEvent;

// 保存の結果を、テストの好きなときに返せるようにする。
const deferSave = () => {
  let settle: { resolve: (record: LocationRecord) => void; reject: (error: Error) => void } | null = null;
  vi.mocked(addLocation).mockImplementation(
    () => new Promise<LocationRecord>((resolve, reject) => { settle = { resolve, reject }; }),
  );
  return () => settle!;
};

describe('useLocationForm', () => {
  let unmount: () => void = () => {};

  beforeEach(() => {
    ({ unmount } = render(<Probe showToast={vi.fn()} />));
    act(() => form.openAdd());
    act(() => form.setValues((previous) => ({ ...previous, name: '横浜スマートセンター' })));
  });

  afterEach(() => {
    unmount();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('保存ボタンを続けて押しても、保存は 1 回だけ', async () => {
    const settle = deferSave();
    const submit = form.submit;
    act(() => {
      void submit(submitEvent());
      void submit(submitEvent());
    });
    expect(addLocation).toHaveBeenCalledTimes(1);

    await act(async () => settle().resolve(SAVED));
    expect(form.isModalOpen).toBe(false);
  });

  it('保存中は閉じる操作を受け付けず、保存に失敗しても入力を残す', async () => {
    const settle = deferSave();
    act(() => { void form.submit(submitEvent()); });
    expect(form.isSaving).toBe(true);

    act(() => form.close());
    expect(form.isModalOpen).toBe(true);

    await act(async () => settle().reject(new Error('拠点の登録に失敗しました')));
    expect(form.isSaving).toBe(false);
    expect(form.isModalOpen).toBe(true);
    expect(form.values.name).toBe('横浜スマートセンター');

    // 保存が終われば閉じられる
    act(() => form.close());
    expect(form.isModalOpen).toBe(false);
  });
});
