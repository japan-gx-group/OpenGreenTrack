// プレビュー（T12）の「温室効果ガス排出」欄（表示のみ）。レポートに採用した OGT の値（sections.ghg）を描く。
// 未算定は 0 にせず「未算定」と出す。サプライヤー別の値は参考値として分けて出し、合計には足さない（docs/ssbj-spec.md §7）。

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/datetime';
import type { OgtAdoptedValue, SsbjGhgAdoption } from '../types';
import { formatDecimalForDisplay } from '../utils/decimal';
import { OGT_DATA_QUALITY_LABELS, ogtMethodLabel, ogtValueLabel } from '../utils/ogtValue';

const ValueRow = ({ value }: { value: OgtAdoptedValue }) => (
  <TableRow>
    <TableCell className="whitespace-normal font-medium">{ogtValueLabel(value)}</TableCell>
    <TableCell className="text-right tabular-nums">
      {value.value.state === 'answered' ? `${formatDecimalForDisplay(value.value.value)} ${value.unit}` : '未算定'}
    </TableCell>
    <TableCell>{value.value.state === 'answered' ? OGT_DATA_QUALITY_LABELS[value.dataQuality] : '未算定'}</TableCell>
    <TableCell>{ogtMethodLabel(value)}</TableCell>
  </TableRow>
);

const ValueTable = ({ values }: { values: OgtAdoptedValue[] }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>区分</TableHead>
        <TableHead className="text-right">排出量</TableHead>
        <TableHead>算定状態</TableHead>
        <TableHead>採用方式</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {values.map(value => <ValueRow key={`${value.scope}-${value.scope3CategoryId ?? 'total'}`} value={value} />)}
    </TableBody>
  </Table>
);

/** ghg が undefined は「この版に GHG の項目が無い」、null は「採用していない」。 */
export const SsbjPreviewGhg = ({ ghg }: { ghg: SsbjGhgAdoption | null | undefined }) => {
  if (ghg === undefined) {
    return <p className="m-0 text-sm text-text-muted">この版には温室効果ガス排出量の項目が含まれていません。</p>;
  }
  if (ghg === null) {
    return (
      <p className="m-0 text-sm text-text-muted">
        OGT の値はまだ採用されていません（「GHG排出量の候補値」の画面で採用できます）。
      </p>
    );
  }

  const totals = ghg.values.filter(value => value.scope3CategoryId === null);
  const categories = ghg.values.filter(value => value.scope3CategoryId !== null);
  const scope2 = ghg.values.find(value => value.scope === 2);
  const breakdown = scope2?.scope === 2 ? scope2.method.factorTypeBreakdown : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-xs text-text-muted">
        OGT から採用した値（採用日時 {formatDateTime(ghg.adoptedAt)}）。集計範囲は組織全体、単位は t-CO2e。
      </p>
      <ValueTable values={totals} />
      <p className="m-0 text-sm text-text-muted">
        Scope 2 はロケーション基準・マーケット基準の区別がありません（基準不明）。ロケーション基準の値は含みません。
        {breakdown &&
          ` 係数区分の内訳：基礎 ${formatDecimalForDisplay(breakdown.basic)}／調整後 ${formatDecimalForDisplay(breakdown.adjusted)}／区分なし ${formatDecimalForDisplay(breakdown.unclassified)} t-CO2e`}
      </p>
      <h4 className="m-0 text-sm font-bold">Scope 3 カテゴリ別</h4>
      <ValueTable values={categories} />
      {ghg.supplierReferences.length > 0 && (
        <>
          <h4 className="m-0 text-sm font-bold">サプライヤー別排出量（参考値。Scope 3 の合計には含めない）</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>カテゴリ</TableHead>
                <TableHead>サプライヤー</TableHead>
                <TableHead className="text-right">排出量</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ghg.supplierReferences.map(item => (
                <TableRow key={`${item.supplierId}-${item.scope3CategoryId}`}>
                  <TableCell>{item.scope3CategoryId}</TableCell>
                  <TableCell>{item.supplierName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDecimalForDisplay(item.emissions)} {item.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
};
