import { describe, expect, it } from 'vitest';
import { scopeAnalysisHref } from '../scopeAnalysisUrl';

describe('scopeAnalysisHref', () => {
  it('会計年度IDをクエリで運ぶ', () => {
    expect(scopeAnalysisHref('fy2024')).toBe('/scope-analysis?fy=fy2024');
  });

  it('年度が特定できないときは素の URL', () => {
    expect(scopeAnalysisHref(null)).toBe('/scope-analysis');
  });

  it('ID はクエリとして安全にエンコードする', () => {
    expect(scopeAnalysisHref('a b&c')).toBe('/scope-analysis?fy=a%20b%26c');
  });
});
