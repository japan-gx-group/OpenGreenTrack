// OGT の候補値の採用（T08b）に使う純粋関数: 画面に表示した候補値の指紋と、採用後の OGT の変化の検出。
//
// 改ざん防止の本体はサーバ側にある（サーバが OGT から候補値を取り直し、その値だけを保存する）。
// 指紋は「利用者が画面で見た値と、サーバが取り直した値が同じか」を確かめるためのもので、
// 採用する値そのものはクライアントから送らない（docs/ssbj-spec.md §7・§8）。

import type { OgtCandidateValue, OgtSupplierReference, SsbjGhgAdoption } from '../types';
import { ogtValueLabel } from './ogtValue';

/** キーを並べ替えた JSON。組み立て順や DB（jsonb）のキー順に左右されない比較のため。 */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

// FNV-1a（64 ビット）。暗号用途ではなく「表示した値が変わったか」の照合用。
// Web Crypto（crypto.subtle）は https / localhost 以外のブラウザで使えないため、同期の単純なハッシュにしている。
const FNV_OFFSET_BASIS = BigInt('0xcbf29ce484222325');
const FNV_PRIME = BigInt('0x100000001b3');
const UINT64_MASK = BigInt('0xffffffffffffffff');

const fnv1a64 = (text: string): string => {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
};

/** 候補値一式の指紋。画面とサーバで同じ候補値なら同じ文字列になる。 */
export const ogtCandidateFingerprint = (
  candidates: readonly OgtCandidateValue[],
  suppliers: readonly OgtSupplierReference[],
): string => fnv1a64(canonicalJson({ candidates, suppliers }));

// 採用後の変化の判定に使う項目（採用日時・採用者と、取得時刻のような付随情報は比べない）。
const comparableValue = (value: OgtCandidateValue) => ({
  value: value.value,
  dataQuality: value.dataQuality,
  method: value.method,
  coverage: value.coverage,
});

const valueKey = (value: Pick<OgtCandidateValue, 'scope' | 'scope3CategoryId'>) =>
  `${value.scope}:${value.scope3CategoryId ?? 'total'}`;

/**
 * 採用した値と現在の候補値を比べ、変わった区分の名前を返す（空なら変化なし）。
 * 採用値は OGT が変わっても書き換えないため、画面で「採用し直すか」を利用者に判断してもらう材料にする。
 */
export const changedOgtValueLabels = (
  adoption: SsbjGhgAdoption,
  candidates: readonly OgtCandidateValue[],
  suppliers: readonly OgtSupplierReference[],
): string[] => {
  const adopted = new Map(adoption.values.map(value => [valueKey(value), value]));
  const labels: string[] = [];
  for (const candidate of candidates) {
    const before = adopted.get(valueKey(candidate));
    if (!before || canonicalJson(comparableValue(before)) !== canonicalJson(comparableValue(candidate))) {
      labels.push(ogtValueLabel(candidate));
    }
  }
  const supplierKey = (supplier: OgtSupplierReference) =>
    canonicalJson([supplier.scope3CategoryId, supplier.supplierId, supplier.supplierName, supplier.emissions]);
  const adoptedSuppliers = adoption.supplierReferences.map(supplierKey).sort();
  const currentSuppliers = suppliers.map(supplierKey).sort();
  if (canonicalJson(adoptedSuppliers) !== canonicalJson(currentSuppliers)) {
    labels.push('サプライヤー別排出量（参考値）');
  }
  return labels;
};

/** 採用する意味のある候補値があるか（すべて未算定なら採用しても「未算定」しか残らない）。 */
export const hasAdoptableOgtValue = (candidates: readonly OgtCandidateValue[]): boolean =>
  candidates.some(candidate => candidate.value.state === 'answered');
