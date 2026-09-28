'use client';

// レポートとしての時間軸の定義（「短期」「中期」「長期」の定義と、計画期間との関係）の表示・編集欄。
// 状態と送信は useSsbjTimeHorizonForm が持ち、ここは表示と入力欄の描画だけを行う。
// 未入力・未確認・非該当は状態のラベルで出し、空欄や「なし」にしない。内部メモは開示しないことを明示する。

import { useId, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SsbjTimeHorizonFormController } from '../hooks/useSsbjTimeHorizonForm';
import { SSBJ_FIELD_STATES, type SsbjFieldState, type SsbjTimeHorizonDefinitions } from '../types';
import { SSBJ_FIELD_STATE_LABELS, formatFieldValue, isAnswered } from '../utils/fieldValue';
import {
  SSBJ_TIME_HORIZON_DEFINITION_FIELDS,
  SSBJ_TIME_HORIZON_DEFINITION_LABELS,
  SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH,
} from '../utils/timeHorizons';

const Row = ({ label, value, muted }: { label: string; value: string; muted: boolean }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-56 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className={muted ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>{value}</dd>
  </div>
);

interface SsbjTimeHorizonCardProps {
  definitions: SsbjTimeHorizonDefinitions;
  isEditing: boolean;
  form: SsbjTimeHorizonFormController;
  onStartEdit: () => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}

export const SsbjTimeHorizonCard = ({
  definitions,
  isEditing,
  form,
  onStartEdit,
  onCancel,
  onSubmit,
}: SsbjTimeHorizonCardProps) => {
  const id = useId();

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="m-0 text-base font-bold">時間軸の定義</h2>
        {!isEditing && (
          <Button type="button" variant="outline" size="sm" onClick={onStartEdit}>
            <Pencil size={14} />
            定義を編集
          </Button>
        )}
      </div>
      <p className="m-0 mb-4 text-xs text-text-muted">
        各リスク・機会の時間軸（短期・中期・長期）が、この会社にとって何を指すかを定義します。
      </p>

      {isEditing ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" data-testid="ssbj-time-horizon-form">
          {SSBJ_TIME_HORIZON_DEFINITION_FIELDS.map(field => {
            const value = form.values[field];
            const isTextEnabled = value.state === 'answered';
            return (
              <div key={field} className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-${field}-state`}>{SSBJ_TIME_HORIZON_DEFINITION_LABELS[field]}</Label>
                <select
                  id={`${id}-${field}-state`}
                  name={`${field}State`}
                  className="gt-field gt-field-select"
                  value={value.state}
                  disabled={form.isSaving}
                  onChange={event => form.setField(field, { state: event.target.value as SsbjFieldState })}
                >
                  {SSBJ_FIELD_STATES.map(state => (
                    <option key={state} value={state}>
                      {SSBJ_FIELD_STATE_LABELS[state]}
                    </option>
                  ))}
                </select>
                <Textarea
                  name={field}
                  aria-label={SSBJ_TIME_HORIZON_DEFINITION_LABELS[field]}
                  maxLength={SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH}
                  placeholder={isTextEnabled ? '開示に載せる文章を入力してください' : '状態を「入力済み」にすると入力できます'}
                  value={isTextEnabled ? value.text : ''}
                  disabled={form.isSaving || !isTextEnabled}
                  onChange={event => form.setField(field, { text: event.target.value })}
                />
              </div>
            );
          })}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-internal-note`}>内部メモ（開示しない）</Label>
            <Textarea
              id={`${id}-internal-note`}
              name="internalNote"
              maxLength={SSBJ_TIME_HORIZON_TEXT_MAX_LENGTH}
              value={form.values.internalNote}
              disabled={form.isSaving}
              onChange={event => form.setInternalNote(event.target.value)}
            />
          </div>

          {form.errors.length > 0 && (
            <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-danger">
              {form.errors.map(error => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={form.isSaving} onClick={onCancel}>
              キャンセル
            </Button>
            <Button type="submit" disabled={form.isSaving}>
              {form.isSaving ? '保存中...' : '定義を保存'}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="m-0 flex flex-col gap-2" data-testid="ssbj-time-horizon-definitions">
          {SSBJ_TIME_HORIZON_DEFINITION_FIELDS.map(field => (
            <Row
              key={field}
              label={SSBJ_TIME_HORIZON_DEFINITION_LABELS[field]}
              value={formatFieldValue(definitions[field])}
              muted={!isAnswered(definitions[field])}
            />
          ))}
          <Row
            label="内部メモ（開示しない）"
            value={definitions.internalNote ?? '未入力'}
            muted={definitions.internalNote === null}
          />
        </dl>
      )}
    </Card>
  );
};
