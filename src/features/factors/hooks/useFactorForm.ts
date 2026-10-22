'use client';

// カスタム係数の作成・編集モーダルの状態と保存処理。
// 標準係数は画面から編集できない（openEdit で弾く）。
// 編集で係数値・単位を変えたとき、その係数で算定済みのデータがあれば保存前に件数を示し、
// 再算定するかを選ばせる（算定済みの結果は算定時の値のまま残り、年度内で新旧の値が混在するため）。
// 再算定の実行は呼び出し側（onRecalculationRequested）が担う。

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { ShowToast } from '@/hooks/useToast';
import {
  addEmissionFactor,
  scopeLabelForEnergyLabel,
  toFactorFormValues,
  updateEmissionFactor,
  type EmissionFactor,
} from '../services/factorService';
import { countCalculatedRecordsForFactor, hasCalculationInputChanged } from '../services/factorRecalculation';
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
  /** 「保存して再算定する」を選んで保存したあとに呼ぶ。その係数で算定済みのデータを算定し直す */
  onRecalculationRequested: (savedFactor: EmissionFactor) => void | Promise<void>;
}

/** 係数値・単位を変えた保存の前に出す確認（その係数で算定済みのデータがあるとき）。 */
export interface FactorRecalculationPrompt {
  /** この係数で算定済みのデータ件数 */
  calculatedCount: number;
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
  /** 保存前の再算定の確認。出していないときは null */
  recalculationPrompt: FactorRecalculationPrompt | null;
  /** 確認に答えて保存する。recalculate = true なら保存後に再算定する */
  confirmRecalculation: (recalculate: boolean) => Promise<void>;
  /** 確認を閉じてフォームの編集に戻る（保存しない） */
  cancelRecalculation: () => void;
}

export function useFactorForm({
  activeGroup,
  availableYears,
  fiscalYear,
  setDatabase,
  showToast,
  onSaved,
  onRecalculationRequested,
}: UseFactorFormParams): FactorFormController {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingFactorId, setEditingFactorId] = useState<string | null>(null);
  // 編集を開いた時点の係数（係数値・単位が変わったかの判定に使う）
  const [editingOriginal, setEditingOriginal] = useState<EmissionFactor | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [recalculationPrompt, setRecalculationPrompt] = useState<FactorRecalculationPrompt | null>(null);
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
    setEditingOriginal(null);
    setRecalculationPrompt(null);
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
    setEditingOriginal(factor);
    setRecalculationPrompt(null);
    setIsModalOpen(true);
  };

  const close = () => {
    setIsModalOpen(false);
    resetFactorForm();
  };

  const save = async (recalculate: boolean) => {
    let saved: EmissionFactor | null = null;
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
      saved = savedRecord;
    } catch (error) {
      showToast(error instanceof Error ? error.message : '排出係数の保存に失敗しました', 'error');
    } finally {
      setIsSaving(false);
    }
    // 再算定は保存が成功したときだけ、保存の後に行う（再算定側の失敗を保存の失敗として出さないため）。
    if (recalculate && saved) {
      await onRecalculationRequested(saved);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!factorForm.name.trim()) {
      showToast('係数名を入力してください', 'error');
      return;
    }

    // 係数値・単位を変えた編集だけ、算定済みのデータがあるか確かめてから保存する。
    if (editingFactorId && editingOriginal && hasCalculationInputChanged(editingOriginal, factorForm)) {
      setIsSaving(true);
      let calculatedCount: number;
      try {
        calculatedCount = await countCalculatedRecordsForFactor(editingFactorId);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'この係数で算定済みのデータの確認に失敗しました', 'error');
        return;
      } finally {
        setIsSaving(false);
      }
      if (calculatedCount > 0) {
        setRecalculationPrompt({ calculatedCount });
        return;
      }
    }

    await save(false);
  };

  const confirmRecalculation = async (recalculate: boolean) => {
    setRecalculationPrompt(null);
    await save(recalculate);
  };

  const cancelRecalculation = () => {
    setRecalculationPrompt(null);
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
    recalculationPrompt,
    confirmRecalculation,
    cancelRecalculation,
  };
}
