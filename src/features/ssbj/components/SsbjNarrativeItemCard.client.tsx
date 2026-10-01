'use client';

// 四本柱・補足の文章（T05）の 1 項目のカード。対応する要求と項番号、記載ガイド・記載例、文章の表示と編集を出す。
// 未入力・未確認・非該当は状態のラベルで出し、空欄や「なし」にしない。内部メモは開示しないことを明示する（docs/ssbj-spec.md §5）。
// 編集中は、穴埋めテンプレートを入れられ、残っている【 】の数を出す。入力中の内容は onDraftChange で親に渡す
// （2 画面エディタのプレビューにその場で反映するため。保存はしない）。

import { useEffect, useId, useState } from 'react';
import { FileText, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSsbjNarrativeForm } from '../hooks/useSsbjNarrativeForm';
import { SSBJ_FIELD_STATES, type SsbjDisclosableText, type SsbjFieldState, type SsbjItemId } from '../types';
import { SSBJ_FIELD_STATE_LABELS, formatFieldValue, isAnswered } from '../utils/fieldValue';
import {
  SSBJ_NARRATIVE_TEXT_MAX_LENGTH,
  normalizeSsbjNarrativeInput,
  ssbjTemplatePlaceholders,
  type SsbjNarrativeEntry,
} from '../utils/narrative';
import { formatParagraphReference, ssbjRequirementsOfItem } from '../utils/requirementMaster';

const PRIORITY_LABELS = { core: '◎', basic: '○' } as const;

interface SsbjNarrativeItemCardProps {
  entry: SsbjNarrativeEntry;
  onSave: (itemId: SsbjItemId, text: SsbjDisclosableText) => Promise<void>;
  /** 承認済みなど、編集させないとき true。 */
  readOnly?: boolean;
  /** 編集中の内容（未保存）。編集をやめた・保存したときは null。 */
  onDraftChange?: (itemId: SsbjItemId, text: SsbjDisclosableText | null) => void;
}

export const SsbjNarrativeItemCard = ({ entry, onSave, readOnly = false, onDraftChange }: SsbjNarrativeItemCardProps) => {
  const id = useId();
  const [isEditing, setIsEditing] = useState(false);
  const form = useSsbjNarrativeForm(entry.itemId, onSave);
  const requirements = ssbjRequirementsOfItem(entry.itemId);
  const { disclosure, internalNote } = entry.text;
  const isTextEnabled = form.values.state === 'answered';
  const placeholders = isTextEnabled ? ssbjTemplatePlaceholders(form.values.text) : [];
  const { itemId } = entry;

  // 編集中の内容を親へ渡す（プレビューにその場で反映する）。編集をやめたら取り消す。
  useEffect(() => {
    onDraftChange?.(itemId, isEditing ? normalizeSsbjNarrativeInput(form.values) : null);
  }, [isEditing, form.values, itemId, onDraftChange]);

  const startEdit = () => {
    form.reset(entry.text);
    setIsEditing(true);
  };

  return (
    <Card data-testid="ssbj-narrative-item">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-bold">{entry.item?.label ?? entry.itemId}</h3>
          <p className="m-0 text-xs text-text-muted">{entry.itemId}</p>
        </div>
        <div className="flex items-center gap-2">
          {entry.item?.kind === 'company_supplement' && <Badge variant="outline">企業固有の補足</Badge>}
          {!entry.item && <Badge variant="warning">要求項目マスターに無い項目</Badge>}
          {!isEditing && entry.item && !readOnly && (
            <Button type="button" variant="outline" size="sm" onClick={startEdit}>
              <Pencil size={14} />
              編集
            </Button>
          )}
        </div>
      </div>

      {requirements.length > 0 && (
        <ul className="m-0 mb-3 flex list-none flex-col gap-1 p-0 text-xs text-text-muted">
          {requirements.map(requirement => (
            <li key={requirement.id}>
              {PRIORITY_LABELS[requirement.priority]} {requirement.id}（{requirement.references.map(formatParagraphReference).join('・')}）
              {requirement.summary}
            </li>
          ))}
        </ul>
      )}

      {entry.item && (
        <details className="mb-3 rounded-md bg-bg-subtle px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-primary">記載ガイド・記載例</summary>
          <ul className="m-0 mt-2 flex list-disc flex-col gap-1 pl-5">
            {requirements.map(requirement => <li key={requirement.id}>{requirement.guide}</li>)}
          </ul>
          <p className="m-0 mt-2 text-xs text-text-muted">記載例（架空の会社）: {entry.item.example}</p>
        </details>
      )}

      {isEditing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={event => void form.submit(event).then(saved => { if (saved) setIsEditing(false); })}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-state`}>開示する文章の状態</Label>
            <select
              id={`${id}-state`}
              className="gt-field gt-field-select"
              value={form.values.state}
              disabled={form.isSaving}
              onChange={event => form.setState(event.target.value as SsbjFieldState)}
            >
              {SSBJ_FIELD_STATES.map(state => (
                <option key={state} value={state}>{SSBJ_FIELD_STATE_LABELS[state]}</option>
              ))}
            </select>
            {entry.item && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={form.isSaving || (isTextEnabled && form.values.text.trim() !== '')}
                  onClick={() => form.applyTemplate(entry.item!.template)}
                >
                  <FileText size={14} />
                  テンプレートを入れる
                </Button>
                <span className="text-xs text-text-muted">
                  {isTextEnabled && form.values.text.trim() !== ''
                    ? '本文が空のときに入れられます'
                    : '【 】の部分を自社の内容に置き換えて使います（試行版の文例です）'}
                </span>
              </div>
            )}
            <Textarea
              aria-label="開示する文章"
              rows={4}
              maxLength={SSBJ_NARRATIVE_TEXT_MAX_LENGTH}
              placeholder={isTextEnabled ? '開示に載せる文章を入力してください' : '状態を「入力済み」にすると入力できます'}
              value={isTextEnabled ? form.values.text : ''}
              disabled={form.isSaving || !isTextEnabled}
              onChange={event => form.setText(event.target.value)}
            />
            {placeholders.length > 0 && (
              <p data-testid="ssbj-template-placeholders" className="m-0 text-xs text-warning">
                置き換えていない【 】が {placeholders.length} か所あります: {placeholders.join(' ')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-internal-note`}>内部メモ（開示しない）</Label>
            <Textarea
              id={`${id}-internal-note`}
              maxLength={SSBJ_NARRATIVE_TEXT_MAX_LENGTH}
              value={form.values.internalNote}
              disabled={form.isSaving}
              onChange={event => form.setInternalNote(event.target.value)}
            />
          </div>
          {form.errors.length > 0 && (
            <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-danger">
              {form.errors.map(error => <li key={error}>{error}</li>)}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={form.isSaving} onClick={() => setIsEditing(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={form.isSaving}>{form.isSaving ? '保存中...' : '保存'}</Button>
          </div>
        </form>
      ) : (
        <dl className="m-0 flex flex-col gap-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">開示する文章</dt>
            <dd className={isAnswered(disclosure) ? 'm-0 text-sm whitespace-pre-wrap' : 'm-0 text-sm text-text-muted'}>
              {formatFieldValue(disclosure)}
            </dd>
          </div>
          <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">内部メモ（開示しない）</dt>
            <dd className={internalNote === null ? 'm-0 text-sm text-text-muted' : 'm-0 text-sm whitespace-pre-wrap'}>
              {internalNote ?? '未入力'}
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
};
