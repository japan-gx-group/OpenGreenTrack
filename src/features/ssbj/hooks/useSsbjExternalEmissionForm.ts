'use client';

// 外部算定値の登録・編集のダイアログの入力と保存。必須項目は保存の前に画面でも確かめるが、正本は DB の制約。
// 二重計上（OGT の採用値・ほかの外部算定値と重なる）は DB が拒否し、そのメッセージを出す。

import { useState } from 'react';
import { createSsbjExternalEmission, updateSsbjExternalEmission } from '../services/externalEmissionService';
import type { SsbjExternalEmission, SsbjGhgGas } from '../types';
import {
  emptyExternalEmissionForm,
  normalizeExternalEmissionInput,
  toExternalEmissionFormValues,
  validateExternalEmissionInput,
  type SsbjExternalEmissionFormValues,
} from '../utils/externalEmission';

const today = (): string => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export interface SsbjExternalEmissionFormController {
  /** 編集中の対象（新規なら 'new'、閉じていれば null）。 */
  editing: SsbjExternalEmission | 'new' | null;
  values: SsbjExternalEmissionFormValues;
  errorMessage: string;
  isSaving: boolean;
  open: (target: SsbjExternalEmission | 'new') => void;
  close: () => void;
  setField: <K extends keyof SsbjExternalEmissionFormValues>(key: K, value: SsbjExternalEmissionFormValues[K]) => void;
  toggleGas: (gas: SsbjGhgGas) => void;
  /** 保存する。成功したら保存した値を、検証・保存に失敗したら null を返す。 */
  save: () => Promise<SsbjExternalEmission | null>;
}

export const useSsbjExternalEmissionForm = (
  report: { id: string; organizationId: string; periodStart: string; periodEnd: string } | null,
): SsbjExternalEmissionFormController => {
  const [editing, setEditing] = useState<SsbjExternalEmission | 'new' | null>(null);
  const [values, setValues] = useState<SsbjExternalEmissionFormValues>(() =>
    emptyExternalEmissionForm({ startDate: '', endDate: '' }, today()));
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const open = (target: SsbjExternalEmission | 'new') => {
    setValues(target === 'new'
      ? emptyExternalEmissionForm({ startDate: report?.periodStart ?? '', endDate: report?.periodEnd ?? '' }, today())
      : toExternalEmissionFormValues(target));
    setErrorMessage('');
    setEditing(target);
  };

  const close = () => {
    if (!isSaving) setEditing(null);
  };

  const setField = <K extends keyof SsbjExternalEmissionFormValues>(key: K, value: SsbjExternalEmissionFormValues[K]) =>
    setValues(previous => ({ ...previous, [key]: value }));

  const toggleGas = (gas: SsbjGhgGas) =>
    setValues(previous => ({
      ...previous,
      gases: previous.gases.includes(gas) ? previous.gases.filter(item => item !== gas) : [...previous.gases, gas],
    }));

  const save = async (): Promise<SsbjExternalEmission | null> => {
    if (!report || editing === null || isSaving) return null;
    const input = normalizeExternalEmissionInput(values);
    const errors = validateExternalEmissionInput(input);
    if (errors.length > 0) {
      setErrorMessage(errors.join('。'));
      return null;
    }
    setIsSaving(true);
    setErrorMessage('');
    try {
      const saved = editing === 'new'
        ? await createSsbjExternalEmission(report, input)
        : await updateSsbjExternalEmission(editing.id, input);
      setEditing(null);
      return saved;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '外部算定値の保存に失敗しました');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  return { editing, values, errorMessage, isSaving, open, close, setField, toggleGas, save };
};
