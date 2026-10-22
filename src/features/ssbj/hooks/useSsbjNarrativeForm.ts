'use client';

// 四本柱・補足の文章（T05）の 1 項目の編集フォームの状態・検証・送信。正規化と検証は utils/narrative.ts に一本化している。
// 入力済み以外の状態では本文を保存しないため、入力した本文が消える保存は、利用者が確認するまで止める。
// 選択式テンプレートの選択（templateInput）は本文と別に持ち、下書きを本文に入れても本文の代わりにはしない。
// 下書きを入れたまま一度も編集せずに「入力済み」で保存するときは、利用者が確認するまで止める
// （下書きは出発点で、最後は利用者が本文を自社の事実に合わせて編集して保存する。docs/ssbj-spec.md §13）。

import { useState, type FormEvent } from 'react';
import type { SsbjDisclosableText, SsbjFieldState, SsbjItemId, SsbjNarrativeTemplateInput } from '../types';
import {
  EMPTY_SSBJ_DISCLOSABLE_TEXT,
  normalizeSsbjNarrativeInput,
  ssbjNarrativeTextWillBeDiscarded,
  toSsbjNarrativeFormValues,
  validateSsbjNarrativeInput,
  type SsbjNarrativeFormValues,
} from '../utils/narrative';
import {
  normalizeSsbjNarrativeTemplateInput,
  validateSsbjNarrativeTemplateInput,
} from '../utils/narrativeTemplateChoice';

export type SsbjNarrativeSave = (
  itemId: SsbjItemId,
  text: SsbjDisclosableText,
  templateInput: SsbjNarrativeTemplateInput | null,
) => Promise<void>;

export interface SsbjNarrativeFormController {
  values: SsbjNarrativeFormValues;
  setState: (state: SsbjFieldState) => void;
  setText: (text: string) => void;
  setInternalNote: (internalNote: string) => void;
  /** 穴埋めテンプレートを本文に入れる（状態は「入力済み」にする）。 */
  applyTemplate: (template: string) => void;
  /** 選択式テンプレートの選択・補足入力を変える（本文は変えない）。 */
  setTemplateInput: (templateInput: SsbjNarrativeTemplateInput | null) => void;
  /**
   * 選択式テンプレートの下書きを本文に入れる（状態は「入力済み」にする）。
   * 本文が空なら下書きにし、書いてあれば後ろに足す（自由入力の本文を上書きしない）。
   */
  insertDraft: (draft: string) => void;
  /** 入力エラー・保存エラー（画面にそのまま並べる）。 */
  errors: string[];
  isSaving: boolean;
  /** 保存済みの文章（と選択式テンプレートの選択）から編集を始める（エラーは消す）。 */
  reset: (text: SsbjDisclosableText, templateInput?: SsbjNarrativeTemplateInput | null) => void;
  /** 検証して保存する。保存できたら true。入力した本文が消える保存は、確認を待って false を返す。 */
  submit: (event?: FormEvent) => Promise<boolean>;
  /** 入力した本文が消える保存の確認を待っているとき true。 */
  isConfirmingDiscard: boolean;
  /** 本文が消えることを確認して保存する。保存できたら true。 */
  confirmDiscard: () => Promise<boolean>;
  /** 保存をやめて編集に戻る（入力した本文はそのまま残す）。 */
  cancelDiscard: () => void;
  /** 選択式テンプレートの下書きを、編集しないまま「入力済み」で保存しようとして、確認を待っているとき true。 */
  isConfirmingUneditedDraft: boolean;
  /** 下書きのままであることを確認して保存する。保存できたら true。 */
  confirmUneditedDraft: () => Promise<boolean>;
  /** 保存をやめて編集に戻る。 */
  cancelUneditedDraft: () => void;
}

export function useSsbjNarrativeForm(
  itemId: SsbjItemId,
  onSave: SsbjNarrativeSave,
): SsbjNarrativeFormController {
  const [values, setValues] = useState<SsbjNarrativeFormValues>(toSsbjNarrativeFormValues(EMPTY_SSBJ_DISCLOSABLE_TEXT));
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState<boolean>(false);
  // 下書きを入れた直後の本文（編集すると一致しなくなる）。下書きを入れていなければ null。
  const [insertedDraftText, setInsertedDraftText] = useState<string | null>(null);
  const [isConfirmingUneditedDraft, setIsConfirmingUneditedDraft] = useState<boolean>(false);

  const reset = (text: SsbjDisclosableText, templateInput: SsbjNarrativeTemplateInput | null = null) => {
    setValues(toSsbjNarrativeFormValues(text, templateInput));
    setErrors([]);
    setIsConfirmingDiscard(false);
    setInsertedDraftText(null);
    setIsConfirmingUneditedDraft(false);
  };

  const save = async (input: SsbjDisclosableText): Promise<boolean> => {
    setIsSaving(true);
    try {
      await onSave(itemId, input, normalizeSsbjNarrativeTemplateInput(itemId, values.templateInput));
      return true;
    } catch (error) {
      setErrors([error instanceof Error ? error.message : '保存に失敗しました']);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const submit = async (event?: FormEvent): Promise<boolean> => {
    event?.preventDefault();
    if (isSaving) return false;

    const input = normalizeSsbjNarrativeInput(values);
    const validationErrors = [
      ...validateSsbjNarrativeInput(itemId, input),
      ...validateSsbjNarrativeTemplateInput(itemId, normalizeSsbjNarrativeTemplateInput(itemId, values.templateInput)),
    ];
    setErrors(validationErrors);
    if (validationErrors.length > 0) return false;

    if (ssbjNarrativeTextWillBeDiscarded(values)) {
      setIsConfirmingDiscard(true);
      return false;
    }
    if (values.state === 'answered' && insertedDraftText !== null && values.text === insertedDraftText) {
      setIsConfirmingUneditedDraft(true);
      return false;
    }
    return save(input);
  };

  const confirmUneditedDraft = async (): Promise<boolean> => {
    setIsConfirmingUneditedDraft(false);
    if (isSaving) return false;
    return save(normalizeSsbjNarrativeInput(values));
  };

  const confirmDiscard = async (): Promise<boolean> => {
    setIsConfirmingDiscard(false);
    if (isSaving) return false;
    return save(normalizeSsbjNarrativeInput(values));
  };

  return {
    values,
    setState: state => setValues(prev => ({ ...prev, state })),
    setText: text => setValues(prev => ({ ...prev, text })),
    setInternalNote: internalNote => setValues(prev => ({ ...prev, internalNote })),
    applyTemplate: template => setValues(prev => ({ ...prev, state: 'answered', text: template })),
    setTemplateInput: templateInput => setValues(prev => ({ ...prev, templateInput })),
    insertDraft: draft => {
      const current = values.state === 'answered' ? values.text.trimEnd() : '';
      const text = current === '' ? draft : `${current}\n\n${draft}`;
      setValues(prev => ({ ...prev, state: 'answered', text }));
      setInsertedDraftText(text);
    },
    errors,
    isSaving,
    reset,
    submit,
    isConfirmingDiscard,
    confirmDiscard,
    cancelDiscard: () => setIsConfirmingDiscard(false),
    isConfirmingUneditedDraft,
    confirmUneditedDraft,
    cancelUneditedDraft: () => setIsConfirmingUneditedDraft(false),
  };
}
