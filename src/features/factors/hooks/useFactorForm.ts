'use client';

// カスタム係数の作成・編集モーダルの状態と保存処理。
// 標準係数は画面から編集できない（openEdit で弾く）。

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import {
  addEmissionFactor,
  scopeLabelForEnergyLabel,
  toFactorFormValues,
  updateEmissionFactor,
  type EmissionFactor,
} from '../services/factorService';
import { factorGroupOf, type FactorGroup } from '../utils/factorGroups';
import { defaultUnitForEnergy, defaultFactorForEnergy } from '../utils/unitOptions';

export type FactorFormValues = Omit<EmissionFactor, 'id'>;

// 新規登録の既定値は開いているタブの群に合わせる。燃料タブから「新規係数を追加」したのに
// Scope 3 の種別が初期選択されていると、保存した係数がその場で別タブへ消えてしまう。
const DEFAULT_ENERGY_BY_GROUP: Record<FactorGroup, EmissionFactor['energyType']> = {
  fuel: '電気',
  activity: '廃棄物',
};

export interface UseFactorFormParams {
  /** 開いているタブ。新規登録の既定値をこの群に合わせる */
  activeGroup: FactorGroup;
  /** 適用年度の候補（降順）。新規登録の既定年度は先頭（最新）を使う */
  availableYears: number[];
  fiscalYear: string;
  setDatabase: Dispatch<SetStateAction<EmissionFactor[]>>;
  showToast: ShowToast;
  /** 保存後に呼ぶ。保存した係数の群を渡すので、別タブへ消えないよう呼び出し側でタブを移す */
  onSaved: (savedGroup: FactorGroup) => void;
}

export interface FactorFormController {
  isModalOpen: boolean;
  /** 編集中の係数 id。新規登録のときは null */
  editingFactorId: string | null;
  values: FactorFormValues;
  setValues: Dispatch<SetStateAction<FactorFormValues>>;
  /** 保存中（一覧のオーバーレイを出すため） */
  isSaving: boolean;
  openCreate: () => void;
  openEdit: (factor: EmissionFactor) => void;
  close: () => void;
  submit: (event: FormEvent) => Promise<void>;
}

export function useFactorForm({
  activeGroup,
  availableYears,
  fiscalYear,
  setDatabase,
  showToast,
  onSaved,
}: UseFactorFormParams): FactorFormController {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingFactorId, setEditingFactorId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // 地域/電力会社・初期ステータスの入力欄は廃止した: カスタム係数は常に regionName='全国'・
  // status='有効' で保存する（事業者別の区別は公式係数の providerName 列が担う）。
  const [factorForm, setFactorForm] = useState<FactorFormValues>({
    name: '',
    energyType: '電気',
    // Scope は入力値ではなくエネルギー種別から決まる（factorService の scopeLabelForEnergyLabel）
    scope: scopeLabelForEnergyLabel('電気'),
    factorValue: 0.000450,
    unit: defaultUnitForEnergy('電気'),
    applicableYear: Number(fiscalYear),
    region: '全国',
    source: '自社設定',
    status: '有効',
    isCustom: true
  });

  const resetFactorForm = (group: FactorGroup = activeGroup) => {
    const energyType = DEFAULT_ENERGY_BY_GROUP[group];
    setFactorForm({
      name: '',
      energyType,
      scope: scopeLabelForEnergyLabel(energyType),
      factorValue: defaultFactorForEnergy(energyType),
      unit: defaultUnitForEnergy(energyType),
      // 適用年度は最新年度を初期選択にする（候補は降順ソート済みなので先頭が最新）。
      // 未取得で候補が空のうちは現在の会計年度にフォールバックする。
      applicableYear: availableYears[0] ?? Number(fiscalYear),
      region: '全国',
      source: '自社設定',
      status: '有効',
      isCustom: true
    });
    setEditingFactorId(null);
  };

  const openCreate = () => {
    resetFactorForm();
    setIsModalOpen(true);
  };

  const openEdit = (factor: EmissionFactor) => {
    if (!factor.isCustom) {
      showToast('標準係数は画面から直接編集できません', 'error');
      return;
    }

    // 列の載せ替えは toFactorFormValues に集約する。ここで列をこぼすと、保存時に
    // toMutationRow が null を書いてその列が消える（出典資料名・出典URL で実際に起きた）。
    // Scope だけは保存済みの値ではなく種別から引き直す（この検証より前に登録された
    // 食い違う係数を開いたとき、保存すれば正しい Scope に直る）。
    setFactorForm({ ...toFactorFormValues(factor), scope: scopeLabelForEnergyLabel(factor.energyType) });
    setEditingFactorId(factor.id);
    setIsModalOpen(true);
  };

  const close = () => {
    setIsModalOpen(false);
    resetFactorForm();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factorForm.name.trim()) {
      showToast('係数名を入力してください', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const recordToSave = {
        ...factorForm,
        isCustom: editingFactorId ? factorForm.isCustom : true,
      };
      const savedRecord = editingFactorId
        ? await updateEmissionFactor(editingFactorId, recordToSave)
        : await addEmissionFactor(recordToSave);

      setDatabase(prev =>
        editingFactorId
          ? prev.map(item => item.id === savedRecord.id ? savedRecord : item)
          : [savedRecord, ...prev],
      );
      setIsModalOpen(false);
      // 保存した係数が別の群だと、一覧に出ないまま「追加しました」だけが出て消えたように見える。
      // 保存先の群のタブへ移動して、追加・更新した行をその場で確認できるようにする。
      const savedGroup = factorGroupOf(savedRecord.energyType);
      onSaved(savedGroup);
      showToast(`「${savedRecord.name}」を${editingFactorId ? '更新' : '追加'}しました`, 'success');
      resetFactorForm(savedGroup);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '排出係数の保存に失敗しました', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return {
    isModalOpen,
    editingFactorId,
    values: factorForm,
    setValues: setFactorForm,
    isSaving,
    openCreate,
    openEdit,
    close,
    submit,
  };
}
