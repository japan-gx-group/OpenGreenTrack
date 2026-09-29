import { describe, expect, it } from 'vitest';
import {
  fictionalGhgAdoption,
  fictionalOgtCandidates,
  fictionalSupplierReferences,
} from '../../__fixtures__/fictionalReport';
import type { OgtCandidateValue } from '../../types';
import { changedOgtValueLabels, hasAdoptableOgtValue, ogtCandidateFingerprint } from '../ogtAdoption';

const withValue = (candidates: OgtCandidateValue[], index: number, value: string): OgtCandidateValue[] =>
  candidates.map((candidate, i) => (i === index ? { ...candidate, value: { state: 'answered', value } } : candidate));

describe('ogtCandidateFingerprint', () => {
  it('同じ候補値なら同じ指紋（16 桁の 16 進数）になり、キーの順序に左右されない', () => {
    const fingerprint = ogtCandidateFingerprint(fictionalOgtCandidates, fictionalSupplierReferences);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    const reordered = fictionalOgtCandidates.map(candidate =>
      Object.fromEntries(Object.entries(candidate).reverse()) as OgtCandidateValue);
    expect(ogtCandidateFingerprint(reordered, fictionalSupplierReferences)).toBe(fingerprint);
  });

  it('値・算定状態・参考値のどれが変わっても指紋が変わる', () => {
    const base = ogtCandidateFingerprint(fictionalOgtCandidates, fictionalSupplierReferences);
    expect(ogtCandidateFingerprint(withValue(fictionalOgtCandidates, 0, '812.346'), fictionalSupplierReferences)).not.toBe(base);
    const quality = fictionalOgtCandidates.map((candidate, i) =>
      i === 0 ? { ...candidate, dataQuality: 'partially_calculated' as const } : candidate);
    expect(ogtCandidateFingerprint(quality, fictionalSupplierReferences)).not.toBe(base);
    expect(ogtCandidateFingerprint(fictionalOgtCandidates, [])).not.toBe(base);
  });
});

describe('changedOgtValueLabels', () => {
  it('採用時と同じなら空', () => {
    expect(changedOgtValueLabels(fictionalGhgAdoption, fictionalOgtCandidates, fictionalSupplierReferences)).toEqual([]);
  });

  it('採用後に値が変わった区分と参考値の変化を名前で返す（取得時刻の違いは変化にしない）', () => {
    const current = withValue(fictionalOgtCandidates, 0, '900.000').map(candidate => ({
      ...candidate,
      source: { ...candidate.source, aggregateUpdatedAt: '2030-01-01T00:00:00Z' },
    }));
    expect(changedOgtValueLabels(fictionalGhgAdoption, current, [])).toEqual(['Scope 1', 'サプライヤー別排出量（参考値）']);
  });
});

describe('hasAdoptableOgtValue', () => {
  it('算定済みの値が 1 つでもあれば採用できる。すべて未算定なら採用しない', () => {
    expect(hasAdoptableOgtValue(fictionalOgtCandidates)).toBe(true);
    const unanswered = fictionalOgtCandidates.map(candidate => ({
      ...candidate, value: { state: 'unanswered' as const }, dataQuality: 'not_calculated' as const,
    }));
    expect(hasAdoptableOgtValue(unanswered)).toBe(false);
  });
});
