'use client';

// SSBJ レポートの基本情報フォーム（作成ダイアログと詳細画面の編集で共用）の状態・検証・送信。
// 保存先（新規作成か更新か）は呼び出し側が onSave で渡す。前後の空白除去と未入力の null 化、
// 必須・文字数の検証は utils/reportValidation.ts に一本化している。

import { useState, type FormEvent } from 'react';
import {
  EMPTY_SSBJ_REPORT_FORM_VALUES,
  normalizeSsbjReportInput,
  validateSsbjReportInput,
  type SsbjReportBasicInfoInput,
  type SsbjReportFormValues,
} from '../utils/reportValidation';

export interface SsbjReportFormController {
  values: SsbjReportFormValues;
  setField: (field: keyof SsbjReportFormValues, value: string) => void;
  /** 入力エラー・保存エラー（画面にそのまま並べる）。 */
  errors: string[];
  isSaving: boolean;
  /** 入力値を差し替えてエラーを消す（ダイアログを開き直す・編集を始めるとき）。 */
  reset: (values?: SsbjReportFormValues) => void;
  /** 検証して保存する。保存できたら true。 */
  submit: (event?: FormEvent) => Promise<boolean>;
}

export function useSsbjReportForm(
  onSave: (input: SsbjReportBasicInfoInput) => Promise<void>,
): SsbjReportFormController {
  const [values, setValues] = useState<SsbjReportFormValues>(EMPTY_SSBJ_REPORT_FORM_VALUES);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const setField = (field: keyof SsbjReportFormValues, value: string) => {
    setValues(prev => ({ ...prev, [field]: value }));
  };

  const reset = (next: SsbjReportFormValues = EMPTY_SSBJ_REPORT_FORM_VALUES) => {
    setValues(next);
    setErrors([]);
  };

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    // 二重送信（連打）で同じレポートを 2 件作らない。
    if (isSaving) return false;

    const input = normalizeSsbjReportInput(values);
    const validationErrors = validateSsbjReportInput(input);
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

  return { values, setField, errors, isSaving, reset, submit };
}
