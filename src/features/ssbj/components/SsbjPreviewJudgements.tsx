// プレビュー（T12）の「該当性・重要性・記載しない理由」欄（T09。sections.judgements。表示のみ）。
// 判断を記録した要求だけを表で出し、判断が済んでいない要求は件数で知らせる（47 件すべてを並べると本文が埋もれるため）。
// 内部の検討理由は showInternalNotes のときだけ「開示しない」と明示して出す（docs/ssbj-spec.md §5）。

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SsbjJudgement } from '../types';
import { formatFieldValue, isAnswered } from '../utils/fieldValue';
import {
  SSBJ_APPLICABILITY_LABELS,
  SSBJ_MATERIALITY_LABELS,
  SSBJ_OMISSION_REASON_LABELS,
  isSsbjJudgementPending,
  isSsbjJudgementRecorded,
  isSsbjOmissionStatementMissing,
  ssbjJudgementEntries,
} from '../utils/judgement';

export const SsbjPreviewJudgements = ({
  judgements,
  showInternalNotes,
}: {
  judgements: SsbjJudgement[] | undefined;
  showInternalNotes: boolean;
}) => {
  if (judgements === undefined) {
    return <p className="m-0 text-sm text-text-muted">この版には該当性・重要性の判断が含まれていません。</p>;
  }

  const entries = ssbjJudgementEntries(judgements);
  const recorded = entries.filter(entry => isSsbjJudgementRecorded(entry.judgement));
  const pendingCount = entries.filter(entry => entry.requirement && isSsbjJudgementPending(entry.judgement)).length;

  return (
    <div className="flex flex-col gap-2">
      <p data-testid="ssbj-preview-judgement-pending" className="m-0 text-sm">
        判断が済んでいない要求: {pendingCount} / {entries.filter(entry => entry.requirement).length} 件
      </p>
      {recorded.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">判断を記録した要求はまだありません。</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>要求</TableHead>
              <TableHead>該当性</TableHead>
              <TableHead>重要性</TableHead>
              <TableHead>記載しない理由</TableHead>
              <TableHead>開示する説明</TableHead>
              {showInternalNotes && <TableHead>内部の検討理由（開示しない）</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {recorded.map(({ requirement, judgement }) => (
              <TableRow key={judgement.requirementId}>
                <TableCell className="min-w-48 whitespace-normal">
                  <span className="block text-xs text-text-muted">{judgement.requirementId}</span>
                  {requirement?.summary ?? '要求項目マスターに無い要求'}
                </TableCell>
                <TableCell>{SSBJ_APPLICABILITY_LABELS[judgement.applicability]}</TableCell>
                <TableCell>{SSBJ_MATERIALITY_LABELS[judgement.materiality]}</TableCell>
                <TableCell className="whitespace-normal">
                  {SSBJ_OMISSION_REASON_LABELS[judgement.omissionReason]}
                  {isSsbjOmissionStatementMissing(judgement) && (
                    <span className="block text-xs text-warning">その旨の説明が未入力</span>
                  )}
                </TableCell>
                <TableCell
                  className={isAnswered(judgement.explanation.disclosure)
                    ? 'min-w-48 whitespace-pre-wrap'
                    : 'min-w-48 whitespace-normal text-text-muted'}
                >
                  {formatFieldValue(judgement.explanation.disclosure)}
                </TableCell>
                {showInternalNotes && (
                  <TableCell className="min-w-48 whitespace-pre-wrap text-text-muted">
                    {judgement.explanation.internalNote ?? '未入力'}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
