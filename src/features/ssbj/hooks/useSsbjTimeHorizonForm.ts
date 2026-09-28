'use client';

// 時間軸の定義の編集フォームの状態・検証・送信。正規化と検証は utils/timeHorizons.ts に一本化している。

import { useState, type FormEvent } from 'react';
import type { SsbjTimeHorizonDefinitions } from '../types';
import {
  EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS,
  normalizeSsbjTimeHorizonInput,
  toSsbjTimeHorizonFormValues,
  validateSsbjTimeHorizonInput,
  type SsbjTextFieldForm,
  type SsbjTimeHorizonDefinitionField,
  type SsbjTimeHorizonFormValues,
} from '../utils/timeHorizons';

export interface SsbjTimeHorizonFormController {
  values: SsbjTimeHorizonFormValues;
  setField: (field: SsbjTimeHorizonDefinitionField, patch: Partial<SsbjTextFieldForm>) => void;
  setInternalNote: (value: string) => void;
  /** 入力エラー・保存エラー（画面にそのまま並べる）。 */
  errors: string[];
  isSaving: boolean;
  /** 保存済みの定義から編集を始める（エラーは消す）。 */
  reset: (definitions: SsbjTimeHorizonDefinitions) => void;
  /** 検証して保存する。保存できたら true。 */
  submit: (event?: FormEvent) => Promise<boolean>;
}

export function useSsbjTimeHorizonForm(
  onSave: (input: SsbjTimeHorizonDefinitions) => Promise<void>,
): SsbjTimeHorizonFormController {
  const [values, setValues] = useState<SsbjTimeHorizonFormValues>(
    toSsbjTimeHorizonFormValues(EMPTY_SSBJ_TIME_HORIZON_DEFINITIONS),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const setField = (field: SsbjTimeHorizonDefinitionField, patch: Partial<SsbjTextFieldForm>) => {
    setValues(prev => ({ ...prev, [field]: { ...prev[field], ...patch } }));
  };

  const setInternalNote = (value: string) => {
    setValues(prev => ({ ...prev, internalNote: value }));
  };

  const reset = (definitions: SsbjTimeHorizonDefinitions) => {
    setValues(toSsbjTimeHorizonFormValues(definitions));
    setErrors([]);
  };

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    if (isSaving) return false;

    const input = normalizeSsbjTimeHorizonInput(values);
    const validationErrors = validateSsbjTimeHorizonInput(input);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return false;

    setIsSaving(true);
    try {
      await onSave(input);
      return true;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '保存に失敗しました']);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return { values, setField, setInternalNote, errors, isSaving, reset, submit };
}
