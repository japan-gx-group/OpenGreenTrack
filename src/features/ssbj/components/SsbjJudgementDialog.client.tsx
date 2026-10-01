'use client';

// 該当性・重要性・記載しない理由（T09）の 1 要求の編集ダイアログ。状態と検証は useSsbjJudgementForm が持つ。
// 開示する説明（記載しない旨など）と、内部の検討理由（開示しない。docs/ssbj-spec.md §5）を分けて入力する。

import { useId, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SsbjJudgementFormController } from '../hooks/useSsbjJudgementForm';
import {
  SSBJ_APPLICABILITIES,
  SSBJ_FIELD_STATES,
  SSBJ_MATERIALITIES,
  SSBJ_OMISSION_REASONS,
  type SsbjApplicability,
  type SsbjFieldState,
  type SsbjMateriality,
  type SsbjOmissionReason,
} from '../types';
import { SSBJ_FIELD_STATE_LABELS } from '../utils/fieldValue';
import {
  SSBJ_APPLICABILITY_LABELS,
  SSBJ_JUDGEMENT_TEXT_MAX_LENGTH,
  SSBJ_MATERIALITY_LABELS,
  SSBJ_OMISSION_REASON_LABELS,
  SSBJ_OMISSION_REASON_REFERENCES,
  isSsbjOmissionStatementMissing,
  normalizeSsbjJudgementInput,
} from '../utils/judgement';
import { findSsbjRequirement, formatParagraphReference } from '../utils/requirementMaster';

interface SsbjJudgementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SsbjJudgementFormController;
  /** 送信（成功したら呼び出し側がダイアログを閉じる）。 */
  onSubmit: (event: FormEvent) => void;
}

const SelectField = <T extends string>({
  id,
  label,
  value,
  options,
  labels,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  disabled: boolean;
  onChange: (value: T) => void;
}) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id}>{label}</Label>
    <select
      id={id}
      className="gt-field gt-field-select"
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value as T)}
    >
      {options.map(option => <option key={option} value={option}>{labels[option]}</option>)}
    </select>
  </div>
);

export const SsbjJudgementDialog = ({ open, onOpenChange, form, onSubmit }: SsbjJudgementDialogProps) => {
  const id = useId();
  const requirement = form.requirementId ? findSsbjRequirement(form.requirementId) : undefined;
  const { values } = form;
  const reference = SSBJ_OMISSION_REASON_REFERENCES[values.omissionReason];
  const isTextEnabled = values.explanationState === 'answered';
  const statementMissing = form.requirementId !== null &&
    isSsbjOmissionStatementMissing(normalizeSsbjJudgementInput(form.requirementId, values));

  return (
    // 保存中は閉じさせない（保存結果を受け取る前に閉じると、保存済みか分からなくなるため）。
    <Dialog open={open} onOpenChange={next => !form.isSaving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>判断の編集（{form.requirementId}）</DialogTitle>
            <DialogDescription>
              {requirement
                ? `${requirement.summary}（${requirement.references.map(formatParagraphReference).join('・')}）`
                : '要求項目マスターに無い要求です'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField<SsbjApplicability>
              id={`${id}-applicability`}
              label="該当性"
              value={values.applicability}
              options={SSBJ_APPLICABILITIES}
              labels={SSBJ_APPLICABILITY_LABELS}
              disabled={form.isSaving}
              onChange={value => form.setValue('applicability', value)}
            />
            <SelectField<SsbjMateriality>
              id={`${id}-materiality`}
              label="重要性"
              value={values.materiality}
              options={SSBJ_MATERIALITIES}
              labels={SSBJ_MATERIALITY_LABELS}
              disabled={form.isSaving}
              onChange={value => form.setValue('materiality', value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <SelectField<SsbjOmissionReason>
              id={`${id}-omission-reason`}
              label="記載しない理由"
              value={values.omissionReason}
              options={SSBJ_OMISSION_REASONS}
              labels={SSBJ_OMISSION_REASON_LABELS}
              disabled={form.isSaving}
              onChange={value => form.setValue('omissionReason', value)}
            />
            {reference && <p className="m-0 text-xs text-text-muted">根拠: {reference}</p>}
            {statementMissing && (
              <p className="m-0 text-xs text-warning">
                この理由で記載しない場合は、その旨の開示が求められます。下の「開示する説明」に書いてください。
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-explanation-state`}>開示する説明の状態</Label>
            <select
              id={`${id}-explanation-state`}
              className="gt-field gt-field-select"
              value={values.explanationState}
              disabled={form.isSaving}
              onChange={event => form.setValue('explanationState', event.target.value as SsbjFieldState)}
            >
              {SSBJ_FIELD_STATES.map(state => (
                <option key={state} value={state}>{SSBJ_FIELD_STATE_LABELS[state]}</option>
              ))}
            </select>
            <Textarea
              aria-label="開示する説明"
              rows={3}
              maxLength={SSBJ_JUDGEMENT_TEXT_MAX_LENGTH}
              placeholder={isTextEnabled ? '例: 経過措置を適用し、スコープ 3 の排出を開示していない。' : '状態を「入力済み」にすると入力できます'}
              value={isTextEnabled ? values.explanationText : ''}
              disabled={form.isSaving || !isTextEnabled}
              onChange={event => form.setValue('explanationText', event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-internal-reason`}>内部の検討理由（開示しない）</Label>
            <Textarea
              id={`${id}-internal-reason`}
              rows={3}
              maxLength={SSBJ_JUDGEMENT_TEXT_MAX_LENGTH}
              placeholder="判断の根拠・検討した資料・確認した人など"
              value={values.internalReason}
              disabled={form.isSaving}
              onChange={event => form.setValue('internalReason', event.target.value)}
            />
          </div>

          {form.errors.length > 0 && (
            <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-danger">
              {form.errors.map(error => <li key={error}>{error}</li>)}
            </ul>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={form.isSaving} onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={form.isSaving}>{form.isSaving ? '保存中...' : '変更を保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
