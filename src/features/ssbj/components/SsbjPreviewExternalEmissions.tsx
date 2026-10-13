// プレビューの「外部で算定した排出量」欄（表示のみ）。保存版の sections.external_emissions を描く。
// OGT の算定値とは別の表にし、出典が外部算定値であることを必ず出す。出典の詳細（算定した者・方法・根拠文書の資料名・
// 確認者）と内部メモは内部記録なので、「内部メモも表示する」を選んだときだけ「開示しない」と明示して出す（§5）。

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import type { SsbjExternalEmissionSnapshot } from '../types';
import { formatDecimalForDisplay } from '../utils/decimal';
import { externalEmissionGasesLabel, externalEmissionLabel } from '../utils/externalEmission';

/** items が undefined は「この版に外部算定値の項目が無い」。 */
export const SsbjPreviewExternalEmissions = ({ items, showInternalNotes }: {
  items: SsbjExternalEmissionSnapshot[] | undefined;
  showInternalNotes: boolean;
}) => {
  if (items === undefined || items.length === 0) {
    return <p className="m-0 text-sm text-text-muted">外部で算定した排出量は採用していません。</p>;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="ssbj-preview-external-emissions">
      <p className="m-0 text-xs text-text-muted">
        出典: 外部算定値（OGT の算定値ではない）。Scope 1・Scope 3 では、OGT の採用値に含まれる CO2 を含まない。Scope 2 は基準ごとの値で、OGT の採用値（基準不明）とは足し合わせない。単位は t-CO2e。
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>区分</TableHead>
            <TableHead>対象ガス</TableHead>
            <TableHead className="text-right">排出量</TableHead>
            <TableHead>期間</TableHead>
            {showInternalNotes && <TableHead>出典の詳細（内部記録・開示しない）</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-normal font-medium">{externalEmissionLabel(item)}</TableCell>
              <TableCell>{externalEmissionGasesLabel(item.gases)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDecimalForDisplay(item.value)} {item.unit}</TableCell>
              <TableCell>{item.period.startDate} 〜 {item.period.endDate}</TableCell>
              {showInternalNotes && (
                <TableCell className="whitespace-normal text-xs text-text-muted">
                  <span className="block">算定: {item.calculatedBy}</span>
                  <span className="block">方法: {item.calculationMethod}</span>
                  <span className="block">根拠文書: {item.evidenceTitle ?? '（見つかりません）'}</span>
                  <span className="block">確認: {item.confirmedByName ?? '不明な利用者'}（{formatDateTime(item.confirmedAt)}）</span>
                  {item.internalNote && <span className="block">内部メモ: {item.internalNote}</span>}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
