'use client';

// 該当性・重要性・記載しない理由の画面（T09。/ssbj/[reportId]/judgements）。
// 要求項目マスターの全要求を章ごとに表で並べ、要求ごとに利用者が判断を記録する。ソフトは判断を自動で決めない
// （行の無い要求はすべて「未確認」）。リスク・機会の識別（T07）とは別の概念として、別の画面で持つ。
// 変更は作業中の内容で、保存版にはレポート詳細の「保存版を作成」で残す（docs/ssbj-spec.md §8）。

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2, Pencil } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSsbjJudgementForm } from '../hooks/useSsbjJudgementForm';
import { useSsbjJudgements } from '../hooks/useSsbjJudgements';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { saveSsbjJudgement } from '../services/judgementService';
import { SSBJ_SECTION_IDS, SSBJ_SECTION_LABELS, type SsbjJudgement } from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import {
  SSBJ_APPLICABILITY_LABELS,
  SSBJ_MATERIALITY_LABELS,
  SSBJ_OMISSION_REASON_LABELS,
  SSBJ_OMISSION_REASON_REFERENCES,
  isSsbjJudgementPending,
  isSsbjOmissionStatementMissing,
  ssbjJudgementEntries,
  type SsbjJudgementEntry,
} from '../utils/judgement';
import { formatParagraphReference } from '../utils/requirementMaster';
import { SsbjJudgementDialog } from './SsbjJudgementDialog.client';
import { SsbjTrialNotice } from './SsbjTrialNotice';

const muted = (isUnconfirmed: boolean) => (isUnconfirmed ? 'text-text-muted' : '');

const JudgementTable = ({ entries, onEdit }: { entries: SsbjJudgementEntry[]; onEdit: (entry: SsbjJudgementEntry) => void }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>要求</TableHead>
        <TableHead>該当性</TableHead>
        <TableHead>重要性</TableHead>
        <TableHead>記載しない理由</TableHead>
        <TableHead>開示する説明</TableHead>
        <TableHead><span className="sr-only">操作</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {entries.map(({ requirement, judgement }) => (
        <TableRow key={judgement.requirementId} data-testid="ssbj-judgement-row">
          <TableCell className="min-w-64 whitespace-normal">
            <span className="block text-xs text-text-muted">
              {judgement.requirementId}
              {requirement && `（${requirement.references.map(formatParagraphReference).join('・')}）`}
            </span>
            {requirement ? requirement.summary : <Badge variant="warning">要求項目マスターに無い要求</Badge>}
          </TableCell>
          <TableCell className={muted(judgement.applicability === 'unconfirmed')}>
            {SSBJ_APPLICABILITY_LABELS[judgement.applicability]}
          </TableCell>
          <TableCell className={muted(judgement.materiality === 'unconfirmed')}>
            {SSBJ_MATERIALITY_LABELS[judgement.materiality]}
          </TableCell>
          <TableCell className="whitespace-normal">
            {SSBJ_OMISSION_REASON_LABELS[judgement.omissionReason]}
            {isSsbjOmissionStatementMissing(judgement) && (
              <Badge variant="warning" className="ml-1">その旨の説明が未入力</Badge>
            )}
          </TableCell>
          <TableCell className={`min-w-48 whitespace-pre-wrap ${muted(!isAnswered(judgement.explanation.disclosure))}`}>
            {formatFieldValue(judgement.explanation.disclosure)}
          </TableCell>
          <TableCell>
            {requirement && (
              <Button type="button" variant="outline" size="sm" onClick={() => onEdit({ requirement, judgement })}>
                <Pencil size={14} />
                編集
              </Button>
            )}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const SsbjJudgements = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: reportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const { judgements, isLoading: judgementsLoading, errorMessage: judgementsError, replace } =
    useSsbjJudgements(report?.id ?? null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);

  const form = useSsbjJudgementForm(async (judgement: SsbjJudgement) => {
    if (!report) return;
    replace(await saveSsbjJudgement(report, judgement));
  });

  const entries = ssbjJudgementEntries(judgements);
  const pendingCount = entries.filter(entry => entry.requirement && isSsbjJudgementPending(entry.judgement)).length;
  const masterCount = entries.filter(entry => entry.requirement).length;
  const visible = pendingOnly ? entries.filter(entry => isSsbjJudgementPending(entry.judgement)) : entries;
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
        {(reportError || judgementsError) && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
            {reportError || judgementsError}
          </div>
        )}
        {reportLoading || judgementsLoading ? (
          <Card><LoadingIndicator label="該当性・重要性の判断を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report && !judgementsError ? (
          <>
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
                <li>「判断が済んでいない」は、該当性が未確認か、該当なのに重要性が未確認の要求です（非該当なら重要性の判断は不要です）。</li>
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p data-testid="ssbj-judgement-pending-count" className="m-0 text-sm font-semibold">
                  判断が済んでいない要求: {pendingCount} / {masterCount} 件
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="ssbj-judgements-pending-only"
                    checked={pendingOnly}
                    onCheckedChange={checked => setPendingOnly(checked === true)}
                  />
                  <Label htmlFor="ssbj-judgements-pending-only">判断が済んでいない要求だけを表示する</Label>
                </div>
              </div>
            </Card>
            {groups.map(group => (
              <Card key={group.key} role="region" aria-label={group.title}>
                <h2 className="m-0 mb-3 text-base font-bold">{group.title}</h2>
                {group.entries.length > 0 ? (
                  <JudgementTable entries={group.entries} onEdit={openEdit} />
                ) : (
                  <p className="m-0 text-sm text-text-muted">判断が済んでいない要求はありません。</p>
                )}
              </Card>
            ))}
            <SsbjJudgementDialog open={dialogOpen} onOpenChange={setDialogOpen} form={form} onSubmit={submit} />
          </>
        ) : null}
      </div>
    </div>
  );
};

