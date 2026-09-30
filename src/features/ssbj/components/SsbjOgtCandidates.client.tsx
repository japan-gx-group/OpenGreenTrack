'use client';

// OGT の GHG 候補値を参照し、レポートに採用する画面（T08a の表示に T08b の採用欄を加えたもの）。
// 採用した値の固定保存は、レポート詳細の「保存版を作成」で行う。

import Link from 'next/link';
import { ArrowLeft, FileCheck2, RefreshCw } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import { useOgtAdoption } from '../hooks/useOgtAdoption';
import { useOgtAdoptionActions } from '../hooks/useOgtAdoptionActions';
import { useOgtCandidates } from '../hooks/useOgtCandidates';
import { useSsbjReport } from '../hooks/useSsbjReport';
import type { OgtCandidateValue } from '../types';
import { formatDecimalForDisplay } from '../utils/decimal';
import { changedOgtValueLabels, hasAdoptableOgtValue } from '../utils/ogtAdoption';
import { OGT_DATA_QUALITY_LABELS, OGT_SOURCE_LABELS, ogtMethodLabel, ogtValueLabel } from '../utils/ogtValue';
import { SsbjOgtAdoptionCard } from './SsbjOgtAdoptionCard.client';
import { SsbjTrialNotice } from './SsbjTrialNotice';

const CandidateRow = ({ candidate }: { candidate: OgtCandidateValue }) => (
  <TableRow>
    <TableCell className="whitespace-normal font-medium">{ogtValueLabel(candidate)}</TableCell>
    <TableCell className="text-right tabular-nums">
      {candidate.value.state === 'answered' ? `${formatDecimalForDisplay(candidate.value.value)} ${candidate.unit}` : '未算定'}
    </TableCell>
    <TableCell>{OGT_DATA_QUALITY_LABELS[candidate.dataQuality]}</TableCell>
    <TableCell>{ogtMethodLabel(candidate)}</TableCell>
    <TableCell>{OGT_SOURCE_LABELS[candidate.source.aggregate]}</TableCell>
    <TableCell>
      {candidate.coverage
        ? `算定済み ${candidate.coverage.calculatedCount} 件／未算定 ${candidate.coverage.uncalculatedCount} 件`
        : '—'}
    </TableCell>
  </TableRow>
);

export const SsbjOgtCandidates = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: reportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const { data, isLoading: candidatesLoading, errorMessage: candidateError, refresh } = useOgtCandidates(report);
  const { adoption, isLoading: adoptionLoading, errorMessage: adoptionError, reload: reloadAdoption } = useOgtAdoption(report?.id ?? null);
  const adoptionActions = useOgtAdoptionActions(reportId);
  const scope2 = data?.candidates.find(candidate => candidate.scope === 2);
  const latestBatch = data?.candidates[0]?.source.latestBatch;
  const updatedAt = data?.candidates[0]?.source.aggregateUpdatedAt;

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="GHG排出量の候補値" description={report?.title ?? 'SSBJレポート'}
        showFiscalYear={false} primaryAction={report ? (
          <Button type="button" variant="outline" disabled={candidatesLoading} onClick={refresh}>
            <RefreshCw size={16} /> 最新データに更新
          </Button>
        ) : null} />
      <div className="flex flex-col gap-4">
        <Link href={`/ssbj/${encodeURIComponent(reportId)}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {(reportError || candidateError || adoptionError) && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
            {reportError || candidateError || adoptionError}
          </div>
        )}
        {reportLoading || candidatesLoading || adoptionLoading ? (
          <Card><LoadingIndicator label="GHG候補値を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
            <p className="mt-2 text-sm text-text-muted">レポートが存在しないか、URLが正しくない可能性があります。</p>
          </Card>
        ) : report && data ? (
          <>
            <Card>
              <h2 className="m-0 mb-3 text-base font-bold">算定条件</h2>
              <dl className="m-0 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-text-muted">対象年度・期間</dt><dd className="m-0">{report.fiscalYearLabel}（{report.periodStart} 〜 {report.periodEnd}）</dd></div>
                <div><dt className="text-text-muted">集計範囲</dt><dd className="m-0">組織全体</dd></div>
                <div><dt className="text-text-muted">集計更新</dt><dd className="m-0">{updatedAt ? formatDateTime(updatedAt) : '集計行なし'}</dd></div>
                <div><dt className="text-text-muted">最新の算定バッチ</dt><dd className="m-0">{latestBatch ? `${latestBatch.status}（${latestBatch.completedAt ? formatDateTime(latestBatch.completedAt) : '完了日時なし'}）` : '履歴なし'}</dd></div>
              </dl>
              {latestBatch && latestBatch.status !== 'completed' && (
                <p role="alert" className="mt-3 text-sm text-danger">最新の算定バッチが完了していません。候補値を確認してください。</p>
              )}
            </Card>
            <SsbjOgtAdoptionCard
              adoption={adoption}
              changedLabels={adoption ? changedOgtValueLabels(adoption, data.candidates, data.suppliers) : []}
              canAdopt={hasAdoptableOgtValue(data.candidates)}
              isSubmitting={adoptionActions.isSubmitting}
              errorMessage={adoptionActions.errorMessage}
              onAdopt={async () => {
                const done = await adoptionActions.adopt(data.candidates, data.suppliers);
                if (done) reloadAdoption();
                return done;
              }}
              onClear={async () => {
                const done = await adoptionActions.clear();
                if (done) reloadAdoption();
                return done;
              }}
            />
            <Card>
              <h2 className="m-0 mb-3 text-base font-bold">Scope別の候補値</h2>
              <Table><TableHeader><TableRow>
                <TableHead>区分</TableHead><TableHead className="text-right">排出量</TableHead>
                <TableHead>算定状態</TableHead><TableHead>採用方式</TableHead><TableHead>取得元</TableHead><TableHead>登録済み活動量</TableHead>
              </TableRow></TableHeader><TableBody>
                {data.candidates.filter(candidate => candidate.scope3CategoryId === null).map(candidate =>
                  <CandidateRow key={candidate.scope} candidate={candidate} />)}
              </TableBody></Table>
              <p className="mt-3 text-sm text-text-muted">Scope 2 のロケーション基準・マーケット基準は不明です。以下は適用係数の区分であり、両基準の算定値ではありません。</p>
              {scope2?.scope === 2 && scope2.method.factorTypeBreakdown && (
                <p className="mt-1 text-sm text-text-muted">Scope 2 係数内訳：基礎 {formatDecimalForDisplay(scope2.method.factorTypeBreakdown.basic)}／調整後 {formatDecimalForDisplay(scope2.method.factorTypeBreakdown.adjusted)}／区分なし {formatDecimalForDisplay(scope2.method.factorTypeBreakdown.unclassified)} t-CO2e</p>
              )}
            </Card>
            <Card>
              <h2 className="m-0 mb-3 text-base font-bold">Scope 3 カテゴリ別</h2>
              <Table><TableHeader><TableRow>
                <TableHead>カテゴリ</TableHead><TableHead className="text-right">排出量</TableHead>
                <TableHead>算定状態</TableHead><TableHead>採用方式</TableHead><TableHead>取得元</TableHead><TableHead>登録済み活動量</TableHead>
              </TableRow></TableHeader><TableBody>
                {data.candidates.filter(candidate => candidate.scope3CategoryId !== null).map(candidate =>
                  <CandidateRow key={candidate.scope3CategoryId} candidate={candidate} />)}
              </TableBody></Table>
              <p className="mt-3 text-sm text-text-muted">各カテゴリでは直接入力または積上げの一方だけを合計に使用します。未入力・未算定は排出量 0 を意味しません。</p>
            </Card>
            {data.suppliers.length > 0 && <Card>
              <h2 className="m-0 mb-3 text-base font-bold">サプライヤー別排出量（参考値）</h2>
              <p className="mb-3 text-sm text-text-muted">Scope 3 の候補値・合計には加算していません。</p>
              <Table><TableHeader><TableRow><TableHead>カテゴリ</TableHead><TableHead>サプライヤー</TableHead><TableHead className="text-right">排出量</TableHead></TableRow></TableHeader>
                <TableBody>{data.suppliers.map(item => <TableRow key={`${item.supplierId}-${item.scope3CategoryId}`}>
                  <TableCell>{item.scope3CategoryId}</TableCell><TableCell>{item.supplierName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDecimalForDisplay(item.emissions)} {item.unit}</TableCell>
                </TableRow>)}</TableBody></Table>
            </Card>}
            <p className="text-xs text-text-muted">「算定済み」は登録されたデータの状態です。未登録データの網羅性は判定できません。OGT の公式係数は実質 CO2 のみで、他の温室効果ガスは含みません。候補値は「採用」するまでレポートに入りません。</p>
          </>
        ) : null}
      </div>
    </div>
  );
};
