'use client';

// リスク・機会の入力欄（登録・編集ダイアログで共用）。状態と検証は useSsbjRiskOpportunityForm が持つ。
// 章・項目への関連付けは、章を選び、項目まで決まっていれば項目の識別子を入れて追加する。
// 項目の一覧（要求項目マスター・文章画面）ができるまでは、識別子の形式だけを検証する。

import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SsbjRiskOpportunityFormController } from '../hooks/useSsbjRiskOpportunityForm';
import {
  SSBJ_FIELD_STATES,
  SSBJ_RISK_OPPORTUNITY_KINDS,
  SSBJ_RISK_OPPORTUNITY_KIND_LABELS,
  SSBJ_SECTION_IDS,
  SSBJ_SECTION_LABELS,
  SSBJ_TIME_HORIZONS,
  SSBJ_TIME_HORIZON_LABELS,
  type SsbjFieldState,
  type SsbjRiskOpportunityKind,
  type SsbjSectionId,
} from '../types';
import { SSBJ_FIELD_STATE_LABELS } from '../utils/fieldValue';
import {
  SSBJ_RISK_TEXT_MAX_LENGTH,
  SSBJ_RISK_TITLE_MAX_LENGTH,
  formatLinkTarget,
  toLinkTarget,
  type SsbjTimeHorizonChoice,
} from '../utils/riskOpportunity';

const NON_ANSWERED_STATES = SSBJ_FIELD_STATES.filter(
  (state): state is Exclude<SsbjFieldState, 'answered'> => state !== 'answered',
);

const LinkEditor = ({ form, idPrefix }: { form: SsbjRiskOpportunityFormController; idPrefix: string }) => {
  const [section, setSection] = useState<SsbjSectionId>('governance');
  const [itemSlug, setItemSlug] = useState<string>('');
  const [linkError, setLinkError] = useState<string>('');

  const add = () => {
    const target = toLinkTarget(section, itemSlug);
    if (!target) {
      setLinkError('項目の識別子は英小文字・数字・アンダースコア（_）で入力してください');
      return;
    }
    form.addLinkTarget(target);
    setItemSlug('');
    setLinkError('');
  };

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1.5 text-sm font-medium">関連する章・項目</legend>
      {form.values.linkTargets.length === 0 ? (
        <p className="m-0 text-xs text-text-muted">まだ関連付けていません。</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {form.values.linkTargets.map(target => (
            <li
              key={target}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs"
            >
              {formatLinkTarget(target)}
              <button
                type="button"
                aria-label={`${formatLinkTarget(target)} の関連付けを外す`}
                className="inline-flex text-text-muted hover:text-danger"
                disabled={form.isSaving}
                onClick={() => form.removeLinkTarget(target)}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-link-section`} className="text-xs">
            章
          </Label>
          <select
            id={`${idPrefix}-link-section`}
            name="linkSection"
            className="gt-field gt-field-select"
            value={section}
            disabled={form.isSaving}
            onChange={event => setSection(event.target.value as SsbjSectionId)}
          >
            {SSBJ_SECTION_IDS.map(id => (
              <option key={id} value={id}>
                {SSBJ_SECTION_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor={`${idPrefix}-link-item`} className="text-xs">
            項目の識別子（任意。空なら章に関連付け）
          </Label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted">{section}.</span>
            <Input
              id={`${idPrefix}-link-item`}
              name="linkItem"
              placeholder="例: climate_resilience"
              value={itemSlug}
              disabled={form.isSaving}
              onChange={event => setItemSlug(event.target.value)}
            />
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={form.isSaving} onClick={add}>
          関連付けを追加
        </Button>
      </div>
      {linkError && <p className="m-0 text-xs text-danger">{linkError}</p>}
    </fieldset>
  );
};

export const SsbjRiskOpportunityFormFields = ({ form }: { form: SsbjRiskOpportunityFormController }) => {
  const id = useId();
  const errorId = `${id}-errors`;
  const hasErrors = form.errors.length > 0;
  const isDescriptionAnswered = form.values.descriptionState === 'answered';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-kind`}>
          区分 <span className="text-danger">*</span>
        </Label>
        <select
          id={`${id}-kind`}
          name="kind"
          className="gt-field gt-field-select"
          value={form.values.kind}
          disabled={form.isSaving}
          onChange={event => form.setField('kind', event.target.value as SsbjRiskOpportunityKind)}
        >
          {SSBJ_RISK_OPPORTUNITY_KINDS.map(kind => (
            <option key={kind} value={kind}>
              {SSBJ_RISK_OPPORTUNITY_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-title`}>
          名称 <span className="text-danger">*</span>
        </Label>
        <Input
          id={`${id}-title`}
          name="title"
          required
          maxLength={SSBJ_RISK_TITLE_MAX_LENGTH}
          placeholder="例: 炭素価格の導入による調達コストの上昇"
          value={form.values.title}
          disabled={form.isSaving}
          aria-describedby={hasErrors ? errorId : undefined}
          onChange={event => form.setField('title', event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-time-horizon`}>時間軸</Label>
        <select
          id={`${id}-time-horizon`}
          name="timeHorizon"
          className="gt-field gt-field-select"
          value={form.values.timeHorizon}
          disabled={form.isSaving}
          onChange={event => form.setField('timeHorizon', event.target.value as SsbjTimeHorizonChoice)}
        >
          {SSBJ_TIME_HORIZONS.map(horizon => (
            <option key={horizon} value={horizon}>
              {SSBJ_TIME_HORIZON_LABELS[horizon]}
            </option>
          ))}
          {NON_ANSWERED_STATES.map(state => (
            <option key={state} value={state}>
              {SSBJ_FIELD_STATE_LABELS[state]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-description-state`}>説明（開示する文章）の状態</Label>
        <select
          id={`${id}-description-state`}
          name="descriptionState"
          className="gt-field gt-field-select"
          value={form.values.descriptionState}
          disabled={form.isSaving}
          onChange={event => form.setField('descriptionState', event.target.value as SsbjFieldState)}
        >
          {SSBJ_FIELD_STATES.map(state => (
            <option key={state} value={state}>
              {SSBJ_FIELD_STATE_LABELS[state]}
            </option>
          ))}
        </select>
        <Textarea
          id={`${id}-description`}
          name="descriptionText"
          aria-label="説明（開示する文章）"
          maxLength={SSBJ_RISK_TEXT_MAX_LENGTH}
          placeholder={isDescriptionAnswered ? '開示に載せる説明を入力してください' : '状態を「入力済み」にすると入力できます'}
          value={isDescriptionAnswered ? form.values.descriptionText : ''}
          disabled={form.isSaving || !isDescriptionAnswered}
          onChange={event => form.setField('descriptionText', event.target.value)}
        />
        {!isDescriptionAnswered && (
          <p className="m-0 text-xs text-text-muted">
            確認中の下書きや検討メモは、開示されない内部メモに書いてください。
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-internal-note`}>内部メモ（開示しない）</Label>
        <Textarea
          id={`${id}-internal-note`}
          name="internalNote"
          maxLength={SSBJ_RISK_TEXT_MAX_LENGTH}
          placeholder="例: 影響額の試算は経営企画部で実施中"
          value={form.values.internalNote}
          disabled={form.isSaving}
          onChange={event => form.setField('internalNote', event.target.value)}
        />
      </div>

      <LinkEditor form={form} idPrefix={id} />

      {hasErrors && (
        <ul id={errorId} role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-danger">
          {form.errors.map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
