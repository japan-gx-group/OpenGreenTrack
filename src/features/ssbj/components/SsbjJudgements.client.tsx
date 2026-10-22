'use client';

// 該当性・重要性・記載しない理由の画面（T09。/ssbj/[reportId]/judgements）。
// 要求項目マスターの全要求を章ごとに表で並べ、要求ごとに利用者が判断を記録する。ソフトは判断を自動で決めない
// （行の無い要求はすべて「未確認」）。リスク・機会の識別（T07）とは別の概念として、別の画面で持つ。
// 変更は作業中の内容で、保存版にはレポート詳細の「保存版を作成」で残す（docs/ssbj-spec.md §8）。
// 一覧では該当性・重要性を選んで続けて保存でき（詳細の内容は変えない）、未判断・要確認・判断済みで絞り込める。
// 記載しない理由・開示する説明・内部の検討理由（根拠）は「詳細」のダイアログで扱う。一覧の保存は詳細と同じ検証を通し、
// 該当性・重要性の 2 列だけを、読込時の更新日時を条件に保存する（他の画面で保存された根拠を古い値に戻さない）。

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Pencil } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSsbjJudgementForm } from '../hooks/useSsbjJudgementForm';
import { useSsbjJudgements } from '../hooks/useSsbjJudgements';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { useSsbjRisksOpportunities } from '../hooks/useSsbjRisksOpportunities';
import { saveSsbjJudgement, saveSsbjJudgementQuickChange } from '../services/judgementService';
import {
  SSBJ_APPLICABILITIES,
  SSBJ_MATERIALITIES,
  SSBJ_SECTION_IDS,
  SSBJ_SECTION_LABELS,
  type SsbjApplicability,
  type SsbjJudgement,
  type SsbjMateriality,
  type SsbjRequirementId,
  type SsbjRiskOpportunity,
} from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import {
  SSBJ_APPLICABILITY_LABELS,
  SSBJ_MATERIALITY_LABELS,
  SSBJ_OMISSION_REASON_LABELS,
  SSBJ_OMISSION_REASON_REFERENCES,
  SSBJ_JUDGEMENT_STATUS_LABELS,
  SSBJ_JUDGEMENT_STATUSES,
  applySsbjJudgementQuickChange,
  normalizeSsbjJudgementInput,
  ssbjJudgementEntries,
  ssbjJudgementReviewReasons,
  ssbjJudgementStatus,
  ssbjRisksByRequirement,
  validateSsbjJudgementInput,
  type SsbjJudgementEntry,
  type SsbjJudgementQuickChange,
  type SsbjJudgementStatus,
} from '../utils/judgement';
import { formatParagraphReference } from '../utils/requirementMaster';
import { isSsbjReportLocked } from '../utils/reportStatus';
import { SsbjEditConflictError } from '../utils/writeError';
import { SsbjEditorLayout } from './SsbjEditorLayout.client';
import { SsbjJudgementDialog } from './SsbjJudgementDialog.client';
import { SsbjLockedNotice } from './SsbjLockedNotice';
import { SsbjTrialNotice } from './SsbjTrialNotice';

const muted = (isUnconfirmed: boolean) => (isUnconfirmed ? 'text-text-muted' : '');

const STATUS_BADGE_VARIANTS: Record<SsbjJudgementStatus, 'neutral' | 'warning' | 'success'> = {
  undecided: 'neutral',
  needs_review: 'warning',
  decided: 'success',
};

type StatusFilter = 'all' | SsbjJudgementStatus | 'with_risks';

interface JudgementRowProps {
  entry: SsbjJudgementEntry;
  risks: SsbjRiskOpportunity[];
  /** 一覧での該当性・重要性の選択を保存する。無い（承認済みなど）ときは選択を出さない。 */
  onQuickChange?: (entry: SsbjJudgementEntry, change: SsbjJudgementQuickChange) => Promise<void>;
  onEdit?: (entry: SsbjJudgementEntry) => void;
}

// 閉じた選択欄で ↑↓ を押したときは、値を変えずに選択肢の一覧を開く。Windows の Edge・Chrome は、閉じた選択欄の ↑↓ で
// その場で値を変えて change を起こすため、一覧の選択がすぐ保存する作りだと、目的の値に着くまでの途中の値も保存してしまう。
// 一覧を開けないブラウザ（showPicker が無い・使えない）では、そのままの動きにする。
const openPickerOnArrowKey = (event: KeyboardEvent<HTMLSelectElement>) => {
  if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.altKey) return;
  const select = event.currentTarget;
  if (typeof select.showPicker !== 'function') return;
  try {
    select.showPicker();
    event.preventDefault();
  } catch {
    // 一覧を開けなければ、ブラウザの既定の動きに任せる。
  }
};

// 1 要求の行。一覧では該当性・重要性だけを選んですぐ保存し、記載しない理由・説明・根拠は詳細の編集で扱う。
const JudgementRow = ({ entry, risks, onQuickChange, onEdit }: JudgementRowProps) => {
  const { requirement, judgement } = entry;
  const [isSaving, setIsSaving] = useState(false);
  // 行のエラー。forJudgement が null（競合）なら次に選ぶまで出し、それ以外はその判断のあいだだけ出す
  // （「詳細」から直して保存すると判断が置き換わるので、直した後に案内が残らない）。
  const [error, setError] = useState<{ message: string; forJudgement: SsbjJudgement | null } | null>(null);
  const status = ssbjJudgementStatus(judgement);
  const reasons = ssbjJudgementReviewReasons(judgement);
  const canQuickEdit = requirement !== null && onQuickChange !== undefined;
  const label = `${judgement.requirementId}`;
  const shownError = error && (error.forJudgement === null || error.forJudgement === judgement) ? error.message : '';
  const errorId = `ssbj-judgement-error-${judgement.requirementId}`;

  const change = async (next: SsbjJudgementQuickChange) => {
    // 保存中の選択は受け付けない（選択欄は保存後の値に戻る）。選択欄を無効にするとフォーカスが外れるので、無効にはしない。
    if (!onQuickChange || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      await onQuickChange(entry, next);
    } catch (caught) {
      setError({
        message: caught instanceof Error ? caught.message : '保存に失敗しました',
        forJudgement: caught instanceof SsbjEditConflictError ? null : judgement,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <TableRow data-testid="ssbj-judgement-row" data-requirement-id={judgement.requirementId}>
      <TableCell className="min-w-64 whitespace-normal">
        <span className="block text-xs text-text-muted">
          {judgement.requirementId}
          {requirement && `（${requirement.references.map(formatParagraphReference).join('・')}）`}
        </span>
        {requirement ? requirement.summary : <Badge variant="warning">要求項目マスターに無い要求</Badge>}
        {risks.length > 0 && (
          <span data-testid="ssbj-judgement-related-risks" className="mt-1 block text-xs text-text-muted">
            関連するリスク・機会: {risks.map(risk => risk.title).join('、')}
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        <Badge variant={STATUS_BADGE_VARIANTS[status]}>{SSBJ_JUDGEMENT_STATUS_LABELS[status]}</Badge>
        {reasons.length > 0 && <span className="mt-1 block text-xs text-warning">{reasons.join('・')}</span>}
      </TableCell>
      <TableCell className={muted(judgement.applicability === 'unconfirmed')}>
        {canQuickEdit ? (
          <select
            aria-label={`${label} の該当性`}
            aria-describedby={shownError ? errorId : undefined}
            aria-invalid={shownError ? true : undefined}
            aria-busy={isSaving}
            className="gt-field gt-field-select"
            value={judgement.applicability}
            onKeyDown={openPickerOnArrowKey}
            onChange={event => void change({ applicability: event.target.value as SsbjApplicability })}
          >
            {SSBJ_APPLICABILITIES.map(value => <option key={value} value={value}>{SSBJ_APPLICABILITY_LABELS[value]}</option>)}
          </select>
        ) : SSBJ_APPLICABILITY_LABELS[judgement.applicability]}
      </TableCell>
      <TableCell className={muted(judgement.materiality === 'unconfirmed')}>
        {canQuickEdit ? (
          <select
            aria-label={`${label} の重要性`}
            aria-describedby={shownError ? errorId : undefined}
            aria-invalid={shownError ? true : undefined}
            aria-busy={isSaving}
            className="gt-field gt-field-select"
            value={judgement.materiality}
            onKeyDown={openPickerOnArrowKey}
            onChange={event => void change({ materiality: event.target.value as SsbjMateriality })}
          >
            {SSBJ_MATERIALITIES.map(value => <option key={value} value={value}>{SSBJ_MATERIALITY_LABELS[value]}</option>)}
          </select>
        ) : SSBJ_MATERIALITY_LABELS[judgement.materiality]}
        {isSaving && <span role="status" className="mt-1 block text-xs text-text-muted">保存中...</span>}
        {shownError && <span id={errorId} role="alert" className="mt-1 block text-xs text-danger">{shownError}</span>}
      </TableCell>
      <TableCell className="whitespace-normal">
        {SSBJ_OMISSION_REASON_LABELS[judgement.omissionReason]}
      </TableCell>
      <TableCell className={`min-w-48 whitespace-pre-wrap ${muted(!isAnswered(judgement.explanation.disclosure))}`}>
        {formatFieldValue(judgement.explanation.disclosure)}
      </TableCell>
      <TableCell>
        {requirement && onEdit && (
          <Button type="button" variant="outline" size="sm" disabled={isSaving} onClick={() => onEdit({ requirement, judgement })}>
            <Pencil size={14} />
            詳細
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};

const JudgementTable = ({
  entries,
  risksByRequirement,
  onQuickChange,
  onEdit,
}: {
  entries: SsbjJudgementEntry[];
  risksByRequirement: Map<SsbjRequirementId, SsbjRiskOpportunity[]>;
} & Pick<JudgementRowProps, 'onQuickChange' | 'onEdit'>) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>要求</TableHead>
        <TableHead>状態</TableHead>
        <TableHead>該当性</TableHead>
        <TableHead>重要性</TableHead>
        <TableHead>記載しない理由</TableHead>
        <TableHead>開示する説明</TableHead>
        <TableHead><span className="sr-only">操作</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {entries.map(entry => (
        <JudgementRow
          key={entry.judgement.requirementId}
          entry={entry}
          risks={risksByRequirement.get(entry.judgement.requirementId) ?? []}
          onQuickChange={onQuickChange}
          onEdit={onEdit}
        />
      ))}
    </TableBody>
  </Table>
);

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'すべて',
  undecided: SSBJ_JUDGEMENT_STATUS_LABELS.undecided,
  needs_review: SSBJ_JUDGEMENT_STATUS_LABELS.needs_review,
  decided: SSBJ_JUDGEMENT_STATUS_LABELS.decided,
  with_risks: 'リスク・機会に関連する要求',
};

export const SsbjJudgements = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: reportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const { judgements, isLoading: judgementsLoading, errorMessage: judgementsError, replace, reload } =
    useSsbjJudgements(report?.id ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const risks = useSsbjRisksOpportunities(reportId, report !== null);

  const form = useSsbjJudgementForm(async (judgement: SsbjJudgement) => {
    if (!report) return;
    replace(await saveSsbjJudgement(report, judgement));
  });

  const entries = ssbjJudgementEntries(judgements);
  const risksByRequirement = ssbjRisksByRequirement(risks.items);
  const masterEntries = entries.filter(entry => entry.requirement);
  const countOf = (status: SsbjJudgementStatus) =>
    masterEntries.filter(entry => ssbjJudgementStatus(entry.judgement) === status).length;
  const matches = (entry: SsbjJudgementEntry) =>
    filter === 'all' ? true
      : filter === 'with_risks' ? risksByRequirement.has(entry.judgement.requirementId)
        : ssbjJudgementStatus(entry.judgement) === filter;
  const visible = entries.filter(matches);
  const groups: { key: string; title: string; entries: SsbjJudgementEntry[] }[] = [
    ...SSBJ_SECTION_IDS.map(sectionId => ({
      key: sectionId,
      title: SSBJ_SECTION_LABELS[sectionId],
      entries: visible.filter(entry => entry.requirement?.sectionId === sectionId),
    })),
    { key: 'general', title: '全般', entries: visible.filter(entry => entry.requirement?.sectionId === null) },
    { key: 'unknown', title: '要求項目マスターに無い要求', entries: visible.filter(entry => !entry.requirement) },
  ].filter(group => group.key !== 'unknown' || group.entries.length > 0);

  const openEdit = (entry: SsbjJudgementEntry) => {
    form.reset(entry.judgement);
    setDialogOpen(true);
  };

  const submit = (event: FormEvent) => {
    void form.submit(event).then(saved => { if (saved) setDialogOpen(false); });
  };

  // 一覧での選択: 保存済みの判断に重ねて詳細の編集と同じ検証を通し、該当性・重要性の 2 列だけを保存する
  // （記載しない理由・説明・根拠は送らない）。読込後に他の画面で保存されていれば競合にして、最新を読み直す。
  const quickChange = async (entry: SsbjJudgementEntry, change: SsbjJudgementQuickChange) => {
    if (!report) return;
    const next = applySsbjJudgementQuickChange(entry.judgement, change);
    const errors = validateSsbjJudgementInput(next);
    if (errors.length > 0) throw new Error(`${errors.join('。')}（「詳細」から直してください）`);
    const saved = judgements.find(judgement => judgement.requirementId === entry.judgement.requirementId);
    try {
      replace(await saveSsbjJudgementQuickChange(report, saved?.updatedAt ?? null, next));
    } catch (error) {
      if (error instanceof SsbjEditConflictError) reload();
      throw error;
    }
  };

  // 保存して、表示中の一覧で次の未判断・要確認の要求を開く（次が無ければ閉じる）。
  const submitAndNext = () => {
    const currentId = form.requirementId;
    void form.submit().then(saved => {
      if (!saved) return;
      const index = visible.findIndex(entry => entry.judgement.requirementId === currentId);
      const next = visible.slice(index + 1).find(entry =>
        entry.requirement && ssbjJudgementStatus(entry.judgement) !== 'decided');
      if (next) form.reset(next.judgement);
      else setDialogOpen(false);
    });
  };

  // 編集ダイアログで選んでいる途中の内容（未保存）も、プレビューにだけ反映する。
  const draftJudgement = dialogOpen && form.requirementId ? normalizeSsbjJudgementInput(form.requirementId, form.values) : null;
  const previewJudgements = draftJudgement
    ? [...judgements.filter(judgement => judgement.requirementId !== draftJudgement.requirementId), draftJudgement]
    : judgements;

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="該当性・重要性の判断" description={report?.title ?? 'SSBJレポート'} showFiscalYear={false} primaryAction={null} />
      <div className="flex flex-col gap-4">
        <Link
          href={`/ssbj/${encodeURIComponent(reportId)}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {report && <SsbjLockedNotice report={report} />}
        {(reportError || judgementsError) && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
            {reportError || judgementsError}
          </div>
        )}
        {risks.errorMessage && (
          <p className="m-0 text-xs text-text-muted">
            リスク・機会を読み込めなかったため、関連するリスク・機会は表示していません（判断の入力はできます）。
          </p>
        )}
        {reportLoading || judgementsLoading ? (
          <Card><LoadingIndicator label="該当性・重要性の判断を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report && !judgementsError ? (
          <SsbjEditorLayout
            report={report}
            overrides={{ judgements: previewJudgements }}
            hasUnsavedDrafts={draftJudgement !== null}
            defaultPanelOpen={false}
          >
            <Card className="flex flex-col gap-3">
              <p className="m-0 text-sm text-text-muted">
                要求項目マスター（暫定版）の要求ごとに、自社に該当するか、重要性があるか、記載しない場合はその理由を記録します。
                判断はソフトが自動で決めることはなく、記録していない要求は「未確認」のままです。リスク・機会の識別とは別に記録します。
                変更は作業中の内容で、保存版にはレポート詳細の「保存版を作成」で残します。
              </p>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-xs text-text-muted">
                {Object.entries(SSBJ_OMISSION_REASON_REFERENCES).map(([reason, reference]) => (
                  <li key={reason}>
                    {SSBJ_OMISSION_REASON_LABELS[reason as keyof typeof SSBJ_OMISSION_REASON_LABELS]}: {reference}
                  </li>
                ))}
                <li>経過措置・商業上の機密で記載しない場合は、その旨の開示が求められます（「開示する説明」に書きます）。</li>
                <li>
                  「要確認」は、該当性が未確認・該当なのに重要性が未確認（非該当なら重要性の判断は不要）・根拠（内部の検討理由か開示する説明）が未入力・
                  記載しない旨の説明が未入力のどれかに当たる要求です。一覧で該当性・重要性を選んだだけの要求は、「詳細」で根拠を書くまで要確認です。
                </li>
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p data-testid="ssbj-judgement-status-count" className="m-0 text-sm font-semibold">
                  {SSBJ_JUDGEMENT_STATUSES.map(status => `${SSBJ_JUDGEMENT_STATUS_LABELS[status]} ${countOf(status)} 件`).join(' / ')}
                  （全 {masterEntries.length} 件）
                </p>
                <div className="flex items-center gap-2">
                  <Label htmlFor="ssbj-judgements-filter">表示する要求</Label>
                  <select
                    id="ssbj-judgements-filter"
                    className="gt-field gt-field-select"
                    value={filter}
                    onChange={event => setFilter(event.target.value as StatusFilter)}
                  >
                    {(Object.keys(FILTER_LABELS) as StatusFilter[]).map(key => (
                      <option key={key} value={key}>{FILTER_LABELS[key]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </Card>
            {groups.map(group => (
              <Card key={group.key} role="region" aria-label={group.title}>
                <h2 className="m-0 mb-3 text-base font-bold">{group.title}</h2>
                {group.entries.length > 0 ? (
                  <JudgementTable
                    entries={group.entries}
                    risksByRequirement={risksByRequirement}
                    onQuickChange={isSsbjReportLocked(report.review) ? undefined : quickChange}
                    onEdit={isSsbjReportLocked(report.review) ? undefined : openEdit}
                  />
                ) : (
                  <p className="m-0 text-sm text-text-muted">条件に合う要求はありません。</p>
                )}
              </Card>
            ))}
            <SsbjJudgementDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              form={form}
              onSubmit={submit}
              onSubmitAndNext={submitAndNext}
            />
          </SsbjEditorLayout>
        ) : null}
      </div>
    </div>
  );
};

