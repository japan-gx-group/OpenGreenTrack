'use client';

// 項目ごとの根拠文書参照。保管先などの内部記録は開示用参照文とは別に表示する。
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSsbjEvidence } from '../hooks/useSsbjEvidence';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { createSsbjEvidence, deleteSsbjEvidence, updateSsbjEvidence } from '../services/evidenceService';
import {
  SSBJ_FIELD_STATES, SSBJ_SECTION_IDS, SSBJ_SECTION_LABELS,
  type SsbjEvidence, type SsbjFieldState, type SsbjSectionId,
} from '../types';
import { formatFieldValue, SSBJ_FIELD_STATE_LABELS } from '../utils/fieldValue';
import {
  EMPTY_SSBJ_EVIDENCE_FORM, normalizeSsbjEvidenceInput, toSsbjEvidenceFormValues,
  validateSsbjEvidenceInput, type SsbjEvidenceFormValues,
} from '../utils/evidence';
import { SsbjTrialNotice } from './SsbjTrialNotice';
import { isSsbjReportLocked } from '../utils/reportStatus';
import { SsbjLockedNotice } from './SsbjLockedNotice';
import { SsbjEditorLayout } from './SsbjEditorLayout.client';

const Detail = ({ label, value }: { label: string; value: string | null }) => (
  <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
    <dt className="w-40 shrink-0 text-xs font-semibold text-text-muted">{label}</dt>
    <dd className="m-0 whitespace-pre-wrap text-sm">{value ?? '未入力'}</dd>
  </div>
);

export const SsbjEvidencePage = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: isReportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const list = useSsbjEvidence(reportId, report !== null);
  const [editing, setEditing] = useState<SsbjEvidence | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SsbjEvidence | null>(null);
  const [form, setForm] = useState<SsbjEvidenceFormValues>(EMPTY_SSBJ_EVIDENCE_FORM);
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const setField = <K extends keyof SsbjEvidenceFormValues>(key: K, value: SsbjEvidenceFormValues[K]) =>
    setForm(previous => ({ ...previous, [key]: value }));

  const openForm = (item: SsbjEvidence | 'new') => {
    setForm(item === 'new' ? EMPTY_SSBJ_EVIDENCE_FORM : toSsbjEvidenceFormValues(item));
    setFormError('');
    setEditing(item);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!report || !editing || isSaving) return;
    const input = normalizeSsbjEvidenceInput(form);
    const errors = validateSsbjEvidenceInput(input);
    if (errors.length) { setFormError(errors.join('。')); return; }
    setIsSaving(true);
    setFormError('');
    try {
      const saved = editing === 'new'
        ? await createSsbjEvidence(report, input)
        : await updateSsbjEvidence(editing.id, input);
      list.upsert(saved);
      setEditing(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '根拠文書の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting || isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      await deleteSsbjEvidence(deleting.id);
      list.remove(deleting.id);
      setDeleting(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '根拠文書の削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  };

  const dot = form.itemId.indexOf('.');
  const section = form.itemId.slice(0, dot) as SsbjSectionId;
  const slug = form.itemId.slice(dot + 1);

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title="根拠文書・主管部署"
        description={report?.title ?? 'SSBJレポートの根拠情報'}
        showFiscalYear={false}
        primaryAction={report && !isSsbjReportLocked(report.review)
          ? <Button type="button" onClick={() => openForm('new')}><Plus size={16} />根拠文書を追加</Button>
          : null}
      />
      <div className="flex flex-col gap-4">
        <Link href={`/ssbj/${encodeURIComponent(reportId)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {report && <SsbjLockedNotice report={report} />}
        {(reportError || list.errorMessage) && <p role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">{reportError || list.errorMessage}</p>}
        {isReportLoading || (report && list.isLoading) ? (
          <Card><LoadingIndicator label="根拠文書を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report && !list.errorMessage ? (
          <SsbjEditorLayout report={report} overrides={{ evidence: list.items }}>
            <Card>
              <h2 className="mb-4 text-base font-bold">登録済みの根拠文書（{list.items.length}件）</h2>
              {list.items.length === 0 ? <p className="text-sm text-text-muted">根拠文書はまだ登録されていません。</p> : (
                <ul className="flex flex-col gap-3">
                  {list.items.map(item => (
                    <li key={item.id} className="rounded-lg border border-border p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <div><p className="text-xs text-text-muted">{item.itemId} · 資料名（内部記録）</p><h3 className="text-sm font-bold">{item.documentTitle}</h3></div>
                        {!isSsbjReportLocked(report.review) && (
                          <div className="flex gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => openForm(item)}><Pencil size={14} />編集</Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => { setDeleteError(''); setDeleting(item); }}><Trash2 size={14} />削除</Button>
                          </div>
                        )}
                      </div>
                      <dl className="flex flex-col gap-2">
                        <Detail label="開示用参照文" value={formatFieldValue(item.disclosure)} />
                        <Detail label="版（内部記録）" value={item.documentVersion} />
                        <Detail label="保管先（内部記録）" value={item.internalLocation} />
                        <Detail label="参照位置（内部記録）" value={item.referencePosition} />
                        <Detail label="主管部署（内部記録）" value={item.ownerDepartment} />
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </SsbjEditorLayout>
        ) : null}
      </div>

      <Dialog open={editing !== null} onOpenChange={open => { if (!open && !isSaving) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={event => void save(event)} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing === 'new' ? '根拠文書の登録' : '根拠文書の編集'}</DialogTitle>
              <DialogDescription>変更は作業中の内容です。固定版に残すにはレポート詳細で「保存版を作成」を押してください。</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-section">章</Label>
              <Select value={section} onValueChange={value => setField('itemId', `${value}.${slug}`)} disabled={isSaving}>
                <SelectTrigger id="evidence-section" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SSBJ_SECTION_IDS.map(id => <SelectItem key={id} value={id}>{SSBJ_SECTION_LABELS[id]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-slug">項目の識別子 *</Label>
              <div className="flex items-center gap-2"><span className="text-xs text-text-muted">{section}.</span><Input id="evidence-slug" value={slug} onChange={event => setField('itemId', `${section}.${event.target.value}`)} placeholder="例: oversight_body" disabled={isSaving} required /></div>
            </div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-title">資料名（内部記録） *</Label><Input id="evidence-title" value={form.documentTitle} onChange={event => setField('documentTitle', event.target.value)} disabled={isSaving} required /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-version">版（任意・内部記録）</Label><Input id="evidence-version" value={form.documentVersion} onChange={event => setField('documentVersion', event.target.value)} disabled={isSaving} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-location">保管先（任意・内部記録）</Label><Input id="evidence-location" value={form.internalLocation} onChange={event => setField('internalLocation', event.target.value)} disabled={isSaving} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-position">参照位置（任意・内部記録）</Label><Input id="evidence-position" value={form.referencePosition} onChange={event => setField('referencePosition', event.target.value)} disabled={isSaving} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-department">主管部署（任意・内部記録）</Label><Input id="evidence-department" value={form.ownerDepartment} onChange={event => setField('ownerDepartment', event.target.value)} disabled={isSaving} /></div>
            <div className="flex flex-col gap-1"><Label htmlFor="evidence-state">開示用参照文の状態</Label>
              <Select value={form.disclosureState} onValueChange={value => setField('disclosureState', value as SsbjFieldState)} disabled={isSaving}>
                <SelectTrigger id="evidence-state" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{SSBJ_FIELD_STATES.map(state => <SelectItem key={state} value={state}>{SSBJ_FIELD_STATE_LABELS[state]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {form.disclosureState === 'answered' && <div className="flex flex-col gap-1"><Label htmlFor="evidence-disclosure">開示用参照文</Label><Textarea id="evidence-disclosure" value={form.disclosureText} onChange={event => setField('disclosureText', event.target.value)} disabled={isSaving} required /></div>}
            {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={isSaving} onClick={() => setEditing(null)}>キャンセル</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? '保存中...' : '保存する'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={open => { if (!open && !isDeleting) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>根拠文書を削除</DialogTitle><DialogDescription>「{deleting?.documentTitle}」を作業中の内容から削除します。保存済みの固定版は変わりません。</DialogDescription></DialogHeader>
          {deleteError && <p role="alert" className="text-sm text-danger">{deleteError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isDeleting} onClick={() => setDeleting(null)}>キャンセル</Button>
            <Button type="button" variant="destructive" disabled={isDeleting} onClick={() => void remove()}>{isDeleting ? '削除中...' : '削除する'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
