'use client';

// リスク・機会の入力フォーム（登録・編集で共用）の状態・検証・送信。
// 保存先（登録か更新か）は呼び出し側が onSave で渡す。正規化と検証は utils/riskOpportunity.ts に一本化している。

import { useState, type FormEvent } from 'react';
import type { SsbjLinkTarget } from '../types';
import {
  EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES,
  normalizeSsbjRiskOpportunityInput,
  sortLinkTargets,
  validateSsbjRiskOpportunityInput,
  type SsbjRiskOpportunityFormValues,
  type SsbjRiskOpportunityInput,
} from '../utils/riskOpportunity';

export interface SsbjRiskOpportunityFormController {
  values: SsbjRiskOpportunityFormValues;
  setField: <K extends keyof SsbjRiskOpportunityFormValues>(
    field: K,
    value: SsbjRiskOpportunityFormValues[K],
  ) => void;
  addLinkTarget: (target: SsbjLinkTarget) => void;
  removeLinkTarget: (target: SsbjLinkTarget) => void;
  /** 入力エラー・保存エラー（画面にそのまま並べる）。 */
  errors: string[];
  isSaving: boolean;
  /** 入力値を差し替えてエラーを消す（ダイアログを開くとき）。 */
  reset: (values?: SsbjRiskOpportunityFormValues) => void;
  /** 検証して保存する。保存できたら true。 */
  submit: (event?: FormEvent) => Promise<boolean>;
}

export function useSsbjRiskOpportunityForm(
  onSave: (input: SsbjRiskOpportunityInput) => Promise<void>,
): SsbjRiskOpportunityFormController {
  const [values, setValues] = useState<SsbjRiskOpportunityFormValues>(EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const setField = <K extends keyof SsbjRiskOpportunityFormValues>(
    field: K,
    value: SsbjRiskOpportunityFormValues[K],
  ) => {
    setValues(prev => ({ ...prev, [field]: value }));
  };

  const addLinkTarget = (target: SsbjLinkTarget) => {
    setValues(prev => ({ ...prev, linkTargets: sortLinkTargets([...prev.linkTargets, target]) }));
  };

  const removeLinkTarget = (target: SsbjLinkTarget) => {
    setValues(prev => ({ ...prev, linkTargets: prev.linkTargets.filter(existing => existing !== target) }));
  };

  const reset = (next: SsbjRiskOpportunityFormValues = EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES) => {
    setValues(next);
    setErrors([]);
  };

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    // 二重送信（連打）で同じリスク・機会を 2 件登録しない。
    if (isSaving) return false;

    const input = normalizeSsbjRiskOpportunityInput(values);
    const validationErrors = validateSsbjRiskOpportunityInput(input);
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

  return { values, setField, addLinkTarget, removeLinkTarget, errors, isSaving, reset, submit };
}
