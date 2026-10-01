'use client';

// 該当性・重要性・記載しない理由（T09）の 1 要求の編集フォームの状態・検証・送信。正規化と検証は utils/judgement.ts に一本化している。

import { useState, type FormEvent } from 'react';
import type { SsbjJudgement, SsbjRequirementId } from '../types';
import {
  emptySsbjJudgement,
  normalizeSsbjJudgementInput,
  toSsbjJudgementFormValues,
  validateSsbjJudgementInput,
  type SsbjJudgementFormValues,
} from '../utils/judgement';

export interface SsbjJudgementFormController {
  /** 編集中の要求（未選択なら null）。 */
  requirementId: SsbjRequirementId | null;
  values: SsbjJudgementFormValues;
  setValue: <K extends keyof SsbjJudgementFormValues>(key: K, value: SsbjJudgementFormValues[K]) => void;
  /** 入力エラー・保存エラー（画面にそのまま並べる）。 */
  errors: string[];
  isSaving: boolean;
  /** 保存済みの判断から編集を始める（エラーは消す）。 */
  reset: (judgement: SsbjJudgement) => void;
  /** 検証して保存する。保存できたら true。 */
  submit: (event?: FormEvent) => Promise<boolean>;
}

export function useSsbjJudgementForm(
  onSave: (judgement: SsbjJudgement) => Promise<void>,
): SsbjJudgementFormController {
  const [requirementId, setRequirementId] = useState<SsbjRequirementId | null>(null);
  const [values, setValues] = useState<SsbjJudgementFormValues>(
    toSsbjJudgementFormValues(emptySsbjJudgement('REQ-GEN-001')),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const reset = (judgement: SsbjJudgement) => {
    setRequirementId(judgement.requirementId);
    setValues(toSsbjJudgementFormValues(judgement));
    setErrors([]);
  };

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    if (isSaving || requirementId === null) return false;

    const input = normalizeSsbjJudgementInput(requirementId, values);
    const validationErrors = validateSsbjJudgementInput(input);
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

  return {
    requirementId,
    values,
    setValue: (key, value) => setValues(prev => ({ ...prev, [key]: value })),
    errors,
    isSaving,
    reset,
    submit,
  };
}
