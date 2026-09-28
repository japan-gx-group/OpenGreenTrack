import { describe, expect, it } from 'vitest';
import { fictionalOgtCandidates } from '../../__fixtures__/fictionalReport';
import type { OgtCandidateValue } from '../../types';
import {
  checkOgtCandidateValue,
  deriveDirectInputDataQuality,
  deriveOgtDataQuality,
} from '../ogtValue';

describe('deriveOgtDataQuality', () => {
  it('集計行が無ければ未算定', () => {
    expect(
      deriveOgtDataQuality({ hasAggregate: false, coverage: { calculatedCount: 5, uncalculatedCount: 0 } }),
    ).toBe('not_calculated');
  });

  it('算定済みレコードが 0 件なら未算定（未算定レコードの有無に関係なく）', () => {
    expect(
      deriveOgtDataQuality({ hasAggregate: true, coverage: { calculatedCount: 0, uncalculatedCount: 0 } }),
    ).toBe('not_calculated');
    expect(
      deriveOgtDataQuality({ hasAggregate: true, coverage: { calculatedCount: 0, uncalculatedCount: 4 } }),
    ).toBe('not_calculated');
  });

  it('未算定レコードが 1 件以上あれば一部未算定', () => {
    expect(
      deriveOgtDataQuality({ hasAggregate: true, coverage: { calculatedCount: 10, uncalculatedCount: 1 } }),
    ).toBe('partially_calculated');
  });

  it('すべて算定済みなら算定済み', () => {
    expect(
      deriveOgtDataQuality({ hasAggregate: true, coverage: { calculatedCount: 10, uncalculatedCount: 0 } }),
    ).toBe('all_calculated');
  });
});

describe('deriveDirectInputDataQuality', () => {
  it('直接入力の行の有無で判定する', () => {
    expect(deriveDirectInputDataQuality(true)).toBe('all_calculated');
    expect(deriveDirectInputDataQuality(false)).toBe('not_calculated');
  });
});

describe('checkOgtCandidateValue', () => {
  const [scope1] = fictionalOgtCandidates;

  it('架空データの候補値はすべて契約を満たす', () => {
    for (const candidate of fictionalOgtCandidates) {
      expect(checkOgtCandidateValue(candidate)).toEqual([]);
    }
  });

  it('未算定なのに値がある候補値を検出する（0 を入れない）', () => {
    const invalid: OgtCandidateValue = {
      ...scope1,
      dataQuality: 'not_calculated',
      value: { state: 'answered', value: '0' },
    };
    expect(checkOgtCandidateValue(invalid)).toContain(
      '未算定の値は未入力（unanswered）にしてください（0 を入れない）',
    );
  });

  it('十進表記でない排出量を検出する', () => {
    const invalid: OgtCandidateValue = { ...scope1, value: { state: 'answered', value: '1.2e3' } };
    expect(checkOgtCandidateValue(invalid)).toContain('排出量が十進表記の文字列ではありません: 1.2e3');
  });

  it('期間の逆転を検出する', () => {
    const invalid: OgtCandidateValue = {
      ...scope1,
      period: { startDate: '2025-03-31', endDate: '2024-04-01' },
    };
    expect(checkOgtCandidateValue(invalid)).toContain('対象期間が正しくありません');
  });

  it('範囲外の Scope 3 カテゴリを検出する', () => {
    const invalid: OgtCandidateValue = {
      ...scope1,
      scope: 3,
      scope3CategoryId: 16,
      method: { kind: 'calculated' },
    };
    expect(checkOgtCandidateValue(invalid)).toContain('Scope 3 カテゴリは 1〜15 です: 16');
  });
});
