'use client';

// 外部算定値の登録・編集のダイアログ（入力欄だけ。状態と保存は useSsbjExternalEmissionForm が持つ）。
// 出典（算定した者・方法・根拠文書）と確認者は必須。根拠文書は、このレポートの「根拠文書・主管部署」から選ぶ。

import type { FormEvent } from 'react';
import { SCOPE3_CATEGORY_NAMES } from '@/features/scope-analysis/services/scopeAnalysisService';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SsbjExternalEmissionFormController } from '../hooks/useSsbjExternalEmissionForm';
import type { SsbjMember } from '../services/memberService';
import { SSBJ_GHG_GASES, SSBJ_SCOPE2_BASES, SSBJ_SCOPE2_BASIS_LABELS, type SsbjEvidence, type SsbjScope2Basis } from '../types';

const CATEGORY_IDS = Array.from({ length: 15 }, (_, index) => index + 1);

interface SsbjExternalEmissionDialogProps {
  form: SsbjExternalEmissionFormController;
  evidence: SsbjEvidence[];
  members: SsbjMember[];
  onSubmit: () => void;
}

export const SsbjExternalEmissionDialog = ({ form, evidence, members, onSubmit }: SsbjExternalEmissionDialogProps) => {
  const { values, isSaving } = form;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Dialog open={form.editing !== null} onOpenChange={open => { if (!open) form.close(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{form.editing === 'new' ? '外部算定値の登録' : '外部算定値の編集'}</DialogTitle>
            <DialogDescription>
              Scope 1・Scope 3 では、OGT の採用値と同じ区分の CO2 は登録できません（二重計上を防ぐため）。Scope 2 は基準ごとの値として、OGT の値（基準不明）とは別に示します。変更は作業中の内容です。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="external-scope">Scope *</Label>
              <select id="external-scope" className="gt-field gt-field-select" value={values.scope} disabled={isSaving}
                onChange={event => form.setField('scope', event.target.value as '' | '1' | '2' | '3')}>
                <option value="">選んでください</option>
                <option value="1">Scope 1</option>
                <option value="2">Scope 2</option>
                <option value="3">Scope 3</option>
              </select>
            </div>
            {values.scope === '3' && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="external-category">Scope 3 のカテゴリ *</Label>
                <select id="external-category" className="gt-field gt-field-select" value={values.scope3CategoryId} disabled={isSaving}
                  onChange={event => form.setField('scope3CategoryId', event.target.value)}>
                  <option value="">選んでください</option>
                  {CATEGORY_IDS.map(id => <option key={id} value={String(id)}>カテゴリ {id}：{SCOPE3_CATEGORY_NAMES[id]}</option>)}
                </select>
              </div>
            )}
            {values.scope === '2' && (
              <div className="flex flex-col gap-1">
                <Label htmlFor="external-basis">Scope 2 の基準 *</Label>
                <select id="external-basis" className="gt-field gt-field-select" value={values.scope2Basis} disabled={isSaving}
                  onChange={event => form.setField('scope2Basis', event.target.value as '' | SsbjScope2Basis)}>
                  <option value="">選んでください</option>
                  {SSBJ_SCOPE2_BASES.map(basis => <option key={basis} value={basis}>{SSBJ_SCOPE2_BASIS_LABELS[basis]}</option>)}
                </select>
              </div>
            )}
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">対象ガス *（1 つ以上）</legend>
            <div className="flex flex-wrap gap-4">
              {SSBJ_GHG_GASES.map(gas => (
                <label key={gas} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={values.gases.includes(gas)} disabled={isSaving} onCheckedChange={() => form.toggleGas(gas)}
                    aria-label={gas} />
                  {gas}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="external-value">排出量（t-CO2e） *</Label>
              <Input id="external-value" inputMode="decimal" value={values.value} disabled={isSaving}
                onChange={event => form.setField('value', event.target.value)} placeholder="例 1.250" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="external-period-start">期間の始まり *</Label>
              <Input id="external-period-start" type="date" value={values.periodStart} disabled={isSaving}
                onChange={event => form.setField('periodStart', event.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="external-period-end">期間の終わり *</Label>
              <Input id="external-period-end" type="date" value={values.periodEnd} disabled={isSaving}
                onChange={event => form.setField('periodEnd', event.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="external-calculated-by">算定した者（会社・部署・システム） *</Label>
            <Input id="external-calculated-by" value={values.calculatedBy} disabled={isSaving}
              onChange={event => form.setField('calculatedBy', event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="external-method">算定方法 *</Label>
            <Textarea id="external-method" rows={3} value={values.calculationMethod} disabled={isSaving}
              onChange={event => form.setField('calculationMethod', event.target.value)}
              placeholder="例: 燃料の使用量に、温対法の排出係数と GWP（AR6）を掛けて算定した" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="external-evidence">根拠文書 *</Label>
            <select id="external-evidence" className="gt-field gt-field-select" value={values.evidenceId} disabled={isSaving}
              onChange={event => form.setField('evidenceId', event.target.value)}>
              <option value="">選んでください</option>
              {evidence.map(item => <option key={item.id} value={item.id}>{item.documentTitle}（{item.itemId}）</option>)}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="external-confirmed-by">確認者 *</Label>
              <select id="external-confirmed-by" className="gt-field gt-field-select" value={values.confirmedByUserId} disabled={isSaving}
                onChange={event => form.setField('confirmedByUserId', event.target.value)}>
                <option value="">選んでください</option>
                {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="external-confirmed-on">確認した日 *</Label>
              <Input id="external-confirmed-on" type="date" value={values.confirmedOn} disabled={isSaving}
                onChange={event => form.setField('confirmedOn', event.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="external-note">内部メモ（任意。開示しない）</Label>
            <Textarea id="external-note" rows={2} value={values.internalNote} disabled={isSaving}
              onChange={event => form.setField('internalNote', event.target.value)} />
          </div>

          {form.errorMessage && <p role="alert" className="m-0 text-sm text-danger">{form.errorMessage}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isSaving} onClick={form.close}>キャンセル</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? '保存中...' : '保存する'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
