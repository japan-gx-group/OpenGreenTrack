import { describe, expect, it } from 'vitest';
import { fictionalOgtCandidates } from '../../__fixtures__/fictionalReport';
import type { OgtCandidateValue } from '../../types';
import {
  checkOgtCandidateValue,
  deriveDirectInputDataQuality,
  deriveOgtDataQuality,
  ogtMethodLabel,
  ogtValueKey,
  ogtValueLabel,
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

describe('表示名', () => {
  it('区分名と対象 ID は Scope 合計とカテゴリで分ける', () => {
    expect(ogtValueLabel({ scope: 1, scope3CategoryId: null })).toBe('Scope 1');
    expect(ogtValueLabel({ scope: 3, scope3CategoryId: 1 })).toBe('カテゴリ 1：購入した製品・サービス');
    expect(ogtValueKey({ scope: 3, scope3CategoryId: null })).toBe('scope3');
    expect(ogtValueKey({ scope: 3, scope3CategoryId: 6 })).toBe('scope3.category6');
  });

  it('採用方式は Scope 1・2 は活動量ベース、Scope 3 カテゴリは直接入力 / 積上げ', () => {
    const scope1 = fictionalOgtCandidates.find(candidate => candidate.scope === 1)!;
    const category1 = fictionalOgtCandidates.find(candidate => candidate.scope3CategoryId === 1)!;
    expect(ogtMethodLabel(scope1)).toBe('活動量 × 排出係数');
    expect(ogtMethodLabel(category1)).toBe('直接入力');
  });
});
