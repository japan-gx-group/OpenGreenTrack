'use client';

// 四本柱の文章の選択式テンプレート（試行版）の入力欄。選択肢と補足入力から下書きを作り、本文に入れる。
// 下書きは利用者が選んだ値だけから作り、選んでいない欄は【 】のまま残す（utils/narrativeTemplateChoice.ts）。
// テンプレートを使っても開示内容は確定しないこと（本文は自社の事実に照らして編集し、利用者が保存・確認する）を画面に出す。
// 本文が書いてあるときは、下書きを後ろに足すだけで、自由入力の本文を上書きしない。

import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SsbjNarrativeTemplateInput } from '../types';
import {
  SSBJ_TEMPLATE_OTHER_OPTION_ID,
  SSBJ_TEMPLATE_TEXT_MAX_LENGTH,
  buildSsbjNarrativeDraft,
  emptySsbjNarrativeTemplateInput,
  isCurrentSsbjNarrativeTemplateInput,
  unfilledSsbjTemplateSlots,
  type SsbjNarrativeChoiceTemplate,
} from '../utils/narrativeTemplateChoice';

interface SsbjNarrativeTemplateChoicesProps {
  template: SsbjNarrativeChoiceTemplate;
  /** 保存済み・編集中の選択（使っていなければ null）。 */
  input: SsbjNarrativeTemplateInput | null;
  onChange: (input: SsbjNarrativeTemplateInput) => void;
  /** 作った下書きを本文に入れる。 */
  onInsert: (draft: string) => void;
  /** 本文が書いてあるとき true（下書きは後ろに足す）。 */
  hasBody: boolean;
  disabled?: boolean;
}

export const SsbjNarrativeTemplateChoices = ({
  template,
  input,
  onChange,
  onInsert,
  hasBody,
  disabled = false,
}: SsbjNarrativeTemplateChoicesProps) => {
  const id = useId();
  // 以前の版の選択は今の選択肢として解釈しない（選び直すと新しい選択で置き換わる）。
  const isStale = input !== null && !isCurrentSsbjNarrativeTemplateInput(input);
  const current = input && !isStale ? input : emptySsbjNarrativeTemplateInput();
  const draft = buildSsbjNarrativeDraft(template, current);
  const unfilled = unfilledSsbjTemplateSlots(template, current);

  const setChoice = (slotId: string, optionId: string) =>
    onChange({ ...current, choices: { ...current.choices, [slotId]: optionId } });
  const setText = (slotId: string, text: string) =>
    onChange({ ...current, texts: { ...current.texts, [slotId]: text } });

  return (
    <div data-testid="ssbj-template-choices" className="flex flex-col gap-3 rounded-md border border-border px-3 py-3">
      <p role="note" className="m-0 text-xs text-text-muted">
        選択肢から作るのは<strong>下書き</strong>です。テンプレートを使っても、開示する内容は自動では確定しません。
        下書きを自社の事実と根拠に照らして書き直し、保存してください（試行版の選択肢で、外部の監修は受けていません）。
      </p>
      {isStale && (
        <p className="m-0 text-xs text-warning">
          以前の版の選択肢で選んだ内容が保存されています。選び直すと、新しい選択で置き換わります（本文は変わりません）。
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {template.slots.map(slot => {
          const fieldId = `${id}-${slot.id}`;
          if (slot.kind === 'text') {
            return (
              <div key={slot.id} className="flex flex-col gap-1.5">
                <Label htmlFor={fieldId}>{slot.label}</Label>
                <Input
                  id={fieldId}
                  maxLength={SSBJ_TEMPLATE_TEXT_MAX_LENGTH}
                  placeholder={slot.hint}
                  value={current.texts[slot.id] ?? ''}
                  disabled={disabled}
                  onChange={event => setText(slot.id, event.target.value)}
                />
              </div>
            );
          }
          const choice = current.choices[slot.id] ?? '';
          return (
            <div key={slot.id} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId}>{slot.label}</Label>
              <select
                id={fieldId}
                className="gt-field gt-field-select"
                value={choice}
                disabled={disabled}
                onChange={event => setChoice(slot.id, event.target.value)}
              >
                <option value="">選んでいません</option>
                {slot.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                {slot.allowOther && <option value={SSBJ_TEMPLATE_OTHER_OPTION_ID}>その他（入力する）</option>}
              </select>
              {slot.allowOther && choice === SSBJ_TEMPLATE_OTHER_OPTION_ID && (
                <Input
                  aria-label={`${slot.label}（その他）`}
                  maxLength={SSBJ_TEMPLATE_TEXT_MAX_LENGTH}
                  value={current.texts[slot.id] ?? ''}
                  disabled={disabled}
                  onChange={event => setText(slot.id, event.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-1">
        <p className="m-0 text-xs font-semibold text-text-muted">下書き（本文に入れるまで保存されません）</p>
        <p data-testid="ssbj-template-draft" className="m-0 rounded-md bg-bg-subtle px-3 py-2 text-sm whitespace-pre-wrap">
          {draft}
        </p>
        {unfilled.length > 0 && (
          <p className="m-0 text-xs text-warning">
            まだ選んでいない欄（【 】のまま入ります）: {unfilled.join('、')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onInsert(draft)}>
          {hasBody ? '下書きを本文の後ろに追加' : '下書きを本文に入れる'}
        </Button>
        {hasBody && <span className="text-xs text-text-muted">今の本文は消さずに残します</span>}
      </div>
    </div>
  );
};
