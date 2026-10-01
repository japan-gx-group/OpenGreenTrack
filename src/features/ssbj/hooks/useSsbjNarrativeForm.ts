'use client';

// 四本柱・補足の文章（T05）の 1 項目の編集フォームの状態・検証・送信。正規化と検証は utils/narrative.ts に一本化している。

import { useState, type FormEvent } from 'react';
import type { SsbjDisclosableText, SsbjFieldState, SsbjItemId } from '../types';
import {
  EMPTY_SSBJ_DISCLOSABLE_TEXT,
  normalizeSsbjNarrativeInput,
  toSsbjNarrativeFormValues,
  validateSsbjNarrativeInput,
  type SsbjNarrativeFormValues,
} from '../utils/narrative';

export interface SsbjNarrativeFormController {
  values: SsbjNarrativeFormValues;
  setState: (state: SsbjFieldState) => void;
  setText: (text: string) => void;
  setInternalNote: (internalNote: string) => void;
  /** 穴埋めテンプレートを本文に入れる（状態は「入力済み」にする）。 */
  applyTemplate: (template: string) => void;
  /** 入力エラー・保存エラー（画面にそのまま並べる）。 */
  errors: string[];
  isSaving: boolean;
  /** 保存済みの文章から編集を始める（エラーは消す）。 */
  reset: (text: SsbjDisclosableText) => void;
  /** 検証して保存する。保存できたら true。 */
  submit: (event?: FormEvent) => Promise<boolean>;
}

export function useSsbjNarrativeForm(
  itemId: SsbjItemId,
  onSave: (itemId: SsbjItemId, text: SsbjDisclosableText) => Promise<void>,
): SsbjNarrativeFormController {
  const [values, setValues] = useState<SsbjNarrativeFormValues>(toSsbjNarrativeFormValues(EMPTY_SSBJ_DISCLOSABLE_TEXT));
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const reset = (text: SsbjDisclosableText) => {
    setValues(toSsbjNarrativeFormValues(text));
    setErrors([]);
  };

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    if (isSaving) return false;

    const input = normalizeSsbjNarrativeInput(values);
    const validationErrors = validateSsbjNarrativeInput(itemId, input);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return false;

    setIsSaving(true);
    try {
      await onSave(itemId, input);
      return true;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '保存に失敗しました']);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    values,
    setState: state => setValues(prev => ({ ...prev, state })),
    setText: text => setValues(prev => ({ ...prev, text })),
    setInternalNote: internalNote => setValues(prev => ({ ...prev, internalNote })),
    applyTemplate: template => setValues(prev => ({ ...prev, state: 'answered', text: template })),
    errors,
    isSaving,
    reset,
    submit,
  };
}
