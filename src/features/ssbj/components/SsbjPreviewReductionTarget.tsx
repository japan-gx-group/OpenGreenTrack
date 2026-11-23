// プレビュー（T12）の「削減目標」欄（表示のみ。R2-32）。OGT の値と一緒に採用した、採用した時点の OGT の削減目標
// （sections.ghg.reductionTarget）を描く。目標未設定・未算定は 0 にせず、その旨を出す。

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SsbjGhgAdoption, SsbjReductionTargetAdoption } from '../types';
import {
  BASE_YEAR_IN_PROGRESS_NOTE,
  BASE_YEAR_NO_EMISSIONS_NOTE,
  formatReportYearReduction,
  formatTargetEmissions,
  formatTargetGap,
  isBaseYearUnusable,
  reductionTargetGap,
} from '../utils/reductionTarget';

/** ghg が undefined は「この版に GHG の項目が無い」、null は「OGT の値を採用していない」。 */
export const SsbjPreviewReductionTarget = ({ ghg }: { ghg: SsbjGhgAdoption | null | undefined }) => {
  if (ghg === undefined) {
    return <p className="m-0 text-sm text-text-muted">この版には削減目標の項目が含まれていません。</p>;
  }
  if (ghg === null) {
    return (
      <p className="m-0 text-sm text-text-muted">
        OGT の削減目標はまだ採用されていません（「GHG排出量の候補値」の画面で、OGT の値と一緒に採用できます）。
      </p>
    );
  }
  const target = ghg.reductionTarget;
  if (target === undefined) {
    return (
      <p className="m-0 text-sm text-text-muted">
        この OGT の値は、削減目標を一緒に採用するようになる前に採用したものです。採用し直すと、削減目標も入ります。
      </p>
    );
  }
  if (target.status === 'not_set') {
    return <p className="m-0 text-sm text-text-muted">採用した時点で、OGT に削減目標が登録されていませんでした。</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="ssbj-preview-reduction-target">
      <p className="m-0 text-xs text-text-muted">
        出典: OGT の削減目標（OGT の値と同時に採用した時点の値）。排出量は Scope 1・2・3 の合計、単位は t-CO2e。
      </p>
      <SsbjReductionTargetDetails target={target} />
    </div>
  );
};

/** 削減目標の中身（基準年度・レポートの年度の目標と実績・年度ごとの削減率）。GHG の候補値の画面でも使う。 */
export const SsbjReductionTargetDetails = ({ target }: { target: Extract<SsbjReductionTargetAdoption, { status: 'set' }> }) => {
  const { baseFiscalYear, reportYear } = target;
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-text-muted">基準年度</dt><dd className="m-0">{baseFiscalYear.label}（{baseFiscalYear.startDate} 〜 {baseFiscalYear.endDate}）</dd></div>
        <div><dt className="text-text-muted">基準年度の排出量</dt><dd className="m-0 tabular-nums">{formatTargetEmissions(target.baseYearEmissions)}</dd></div>
        <div><dt className="text-text-muted">{reportYear.targetYear} 年度（レポートの年度）の目標</dt><dd className="m-0">{formatReportYearReduction(target)}</dd></div>
        <div><dt className="text-text-muted">目標排出量</dt><dd className="m-0 tabular-nums">{reportYear.reductionPercent.state === 'answered' ? formatTargetEmissions(reportYear.targetEmissions) : '目標未設定'}</dd></div>
        <div><dt className="text-text-muted">実績排出量</dt><dd className="m-0 tabular-nums">{formatTargetEmissions(reportYear.actualEmissions)}</dd></div>
        <div><dt className="text-text-muted">実績と目標の差</dt><dd className="m-0 tabular-nums">{formatTargetGap(reductionTargetGap(target))}</dd></div>
      </dl>
      {isBaseYearUnusable(target) && <p role="note" className="m-0 text-xs text-warning">{BASE_YEAR_NO_EMISSIONS_NOTE}。</p>}
      {!target.baseYearEnded && <p role="note" className="m-0 text-xs text-warning">{BASE_YEAR_IN_PROGRESS_NOTE}。</p>}
      {target.targetYears.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>年度</TableHead>
              <TableHead className="text-right">削減率（基準年度比）</TableHead>
              <TableHead className="text-right">目標排出量</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {target.targetYears.map(year => (
              <TableRow key={year.targetYear}>
                <TableCell>{year.targetYear} 年度</TableCell>
                <TableCell className="text-right tabular-nums">{year.reductionPercent}%</TableCell>
                <TableCell className="text-right tabular-nums">{formatTargetEmissions(year.targetEmissions)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="m-0 text-sm text-text-muted">年度ごとの削減率は登録されていません。</p>
      )}
    </div>
  );
};
