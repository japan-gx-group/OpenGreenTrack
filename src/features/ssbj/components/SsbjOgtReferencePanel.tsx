// 2 画面エディタの右側「OGT の値」（カンペ。表示のみ）。執筆中に、OGT の最新の排出量と、レポートに採用した値を見比べる。
// ここに出す最新の値はレポートには入らない（レポートに入るのは GHG の画面で採用した値だけ）。

import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/datetime';
import type { OgtCandidateData } from '../services/ogtCandidateService';
import type { OgtCandidateValue, SsbjGhgAdoption } from '../types';
import { formatDecimalForDisplay } from '../utils/decimal';
import { OGT_DATA_QUALITY_LABELS, ogtValueKey, ogtValueLabel } from '../utils/ogtValue';

const valueText = (value: OgtCandidateValue | undefined): string =>
  !value ? '—' : value.value.state === 'answered'
    ? `${formatDecimalForDisplay(value.value.value)} ${value.unit}`
    : '未算定';

interface SsbjOgtReferencePanelProps {
  reportId: string;
  data: OgtCandidateData | null;
  adoption: SsbjGhgAdoption | null;
  changedLabels: string[];
  isLoading: boolean;
  errorMessage: string;
  onRefresh: () => void;
}

export const SsbjOgtReferencePanel = ({
  reportId, data, adoption, changedLabels, isLoading, errorMessage, onRefresh,
}: SsbjOgtReferencePanelProps) => {
  const adopted = new Map((adoption?.values ?? []).map(value => [ogtValueKey(value), value]));
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="ssbj-ogt-reference">
      <p className="m-0 text-xs text-text-muted">
        OGT の最新の値（参照用）と、レポートに採用した値です。レポートに入るのは採用した値だけです。
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-muted">
          {adoption ? `採用済み（${formatDateTime(adoption.adoptedAt)}）` : 'まだ採用していません'}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={onRefresh}>
          <RefreshCw size={14} /> 最新の値を読み直す
        </Button>
      </div>
      {errorMessage && <p role="alert" className="m-0 text-danger">{errorMessage}</p>}
      {isLoading && !data ? <p className="m-0 text-text-muted">OGT の値を読み込んでいます...</p> : data && (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="py-1 pr-2 font-semibold">区分</th>
              <th className="py-1 pr-2 text-right font-semibold">OGT の最新</th>
              <th className="py-1 pr-2 text-right font-semibold">採用した値</th>
              <th className="py-1 font-semibold">算定状態</th>
            </tr>
          </thead>
          <tbody>
            {data.candidates.map(candidate => {
              const key = ogtValueKey(candidate);
              const changed = changedLabels.includes(ogtValueLabel(candidate));
              return (
                <tr key={key} className={changed ? 'border-b border-border bg-warning-soft' : 'border-b border-border'}>
                  <td className="py-1 pr-2">{ogtValueLabel(candidate)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{valueText(candidate)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{adoption ? valueText(adopted.get(key)) : '—'}</td>
                  <td className="py-1">
                    {candidate.value.state === 'answered' ? OGT_DATA_QUALITY_LABELS[candidate.dataQuality] : '未算定'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Link href={`/ssbj/${encodeURIComponent(reportId)}/ghg`} className="text-xs font-semibold text-primary hover:underline">
        GHG排出量の候補値の画面で、算定条件の確認と採用をする
      </Link>
    </div>
  );
};
