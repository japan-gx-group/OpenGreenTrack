'use client';

// 拠点の追加/編集モーダルの状態と保存処理。同じフォーム・モーダルを使い回し、
// editingLocationId が null なら新規追加、それ以外なら既存拠点の編集。

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import { addLocation, updateLocation } from '../services/locationService';
import { validateLocationNameAndPerson } from '../services/locationValidation';
import type { LocationRecord, NewLocationInput } from '../types';

// 稼働状況は活動量入力の拠点選択（稼働中・一時停止のみ）に効くため、フォームからも
// 変更できるようにしている。新規は 'active' を初期値にする。
const EMPTY_LOCATION: NewLocationInput = {
  name: '',
  region: 'Kanto',
  type: 'office',
  person: '',
  status: 'active'
};

export interface LocationFormController {
  isModalOpen: boolean;
  /** 編集中の拠点 id。新規追加のときは null */
  editingLocationId: string | null;
  values: NewLocationInput;
  setValues: Dispatch<SetStateAction<NewLocationInput>>;
  /** 保存中（一覧のオーバーレイを出すため） */
  isSaving: boolean;
  openAdd: () => void;
  openEdit: (row: LocationRecord) => void;
  close: () => void;
  submit: (event: FormEvent) => Promise<void>;
}

export function useLocationForm(
  setDatabase: Dispatch<SetStateAction<LocationRecord[]>>,
  showToast: ShowToast,
): LocationFormController {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [values, setValues] = useState<NewLocationInput>(EMPTY_LOCATION);

  // フォームを初期値に戻す（新規追加のデフォルト）。
  const resetLocationForm = () => {
    setValues(EMPTY_LOCATION);
  };

  const openAdd = () => {
    setEditingLocationId(null);
    resetLocationForm();
    setIsModalOpen(true);
  };

  // 既存拠点の編集モーダルを開く。行の現在値をフォームへ流し込む。
  const openEdit = (row: LocationRecord) => {
    setEditingLocationId(row.id);
    setValues({
      name: row.name,
      region: row.region,
      type: row.type,
      person: row.person,
      status: row.status,
    });
    setIsModalOpen(true);
  };

  // モーダルを閉じ、編集状態とフォームを初期化する。
  const close = () => {
    setIsModalOpen(false);
    setEditingLocationId(null);
    resetLocationForm();
  };

  // 追加/編集の共通送信ハンドラ。editingLocationId の有無で分岐する。
  // 前後空白は保存前に落とす（CSVインポートと同じ扱い。空白違いの同名拠点を作らない）。
  // 必須・文字数上限の判定と文言も CSV と共通（locationValidation.ts）。
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input: NewLocationInput = {
      ...values,
      name: values.name.trim(),
      person: values.person.trim(),
    };
    const [validationError] = validateLocationNameAndPerson(input.name, input.person);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    try {
      setIsSaving(true);
      if (editingLocationId) {
        const updated = await updateLocation(editingLocationId, input);
        setDatabase(prev => prev.map(item => item.id === updated.id ? updated : item));
        showToast(`拠点「${updated.name}」を更新しました`, 'success');
      } else {
        const recordToSave = await addLocation(input);
        setDatabase(prev => [recordToSave, ...prev]);
        showToast(`拠点「${recordToSave.name}」を新規登録しました`, 'success');
      }
      close();
    } catch (error) {
      const fallback = editingLocationId ? '拠点の更新に失敗しました' : '拠点の登録に失敗しました';
      showToast(error instanceof Error ? error.message : fallback, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return { isModalOpen, editingLocationId, values, setValues, isSaving, openAdd, openEdit, close, submit };
}
