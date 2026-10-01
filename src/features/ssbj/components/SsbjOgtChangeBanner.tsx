// 採用した OGT の値が、採用した後で OGT 側で変わったことを入力画面の上部で知らせる帯（表示のみ）。
// 採用した値は自動では変わらない（docs/ssbj-spec.md §7）。採用し直すかは利用者が GHG の画面で決める。

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

export const SsbjOgtChangeBanner = ({ reportId, changedLabels }: { reportId: string; changedLabels: string[] }) => {
  if (changedLabels.length === 0) return null;
  return (
    <div role="status" data-testid="ssbj-ogt-change-banner"
      className="flex items-start gap-2 rounded-md bg-warning-soft px-4 py-3 text-sm text-warning">
      <AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <p className="m-0">
        レポートに採用した後で、OGT の値が変わりました（{changedLabels.join('、')}）。採用した値は自動では更新されません。
        <Link href={`/ssbj/${encodeURIComponent(reportId)}/ghg`} className="font-semibold underline">GHG排出量の候補値</Link>
        で確認し、必要なら採用し直してください。
      </p>
    </div>
  );
};
