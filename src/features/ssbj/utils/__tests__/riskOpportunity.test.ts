import { describe, expect, it } from 'vitest';
import { fictionalRisksOpportunities } from '../../__fixtures__/fictionalReport';
import type { SsbjRiskOpportunity } from '../../types';
import {
  EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES,
  formatLinkTarget,
  normalizeSsbjRiskOpportunityInput,
  sortLinkTargets,
  toLinkTarget,
  toSsbjRiskOpportunityFormValues,
  validateSsbjRiskOpportunityInput,
  type SsbjRiskOpportunityFormValues,
  type SsbjRiskOpportunityInput,
} from '../riskOpportunity';

const inputOf = (item: SsbjRiskOpportunity): SsbjRiskOpportunityInput => ({
  kind: item.kind,
  title: item.title,
  riskType: item.riskType,
  description: item.description,
  timeHorizon: item.timeHorizon,
  linkTargets: item.linkTargets,
});

const values = (overrides: Partial<SsbjRiskOpportunityFormValues>): SsbjRiskOpportunityFormValues => ({
  ...EMPTY_SSBJ_RISK_OPPORTUNITY_FORM_VALUES,
  title: '炭素価格の導入',
  ...overrides,
});

describe('normalizeSsbjRiskOpportunityInput', () => {
  it('入力済みの説明は前後の空白を落として値を持つ', () => {
    const input = normalizeSsbjRiskOpportunityInput(
      values({ descriptionState: 'answered', descriptionText: '  説明文  ', timeHorizon: 'short_term' }),
    );
    expect(input.description.disclosure).toEqual({ state: 'answered', value: '説明文' });
    expect(input.timeHorizon).toEqual({ state: 'answered', value: 'short_term' });
  });

  it('入力済み以外の説明は本文を捨てて状態だけ持つ（未確認の下書きを開示欄に残さない）', () => {
    const input = normalizeSsbjRiskOpportunityInput(
      values({ descriptionState: 'unconfirmed', descriptionText: '確認中の下書き' }),
    );
    expect(input.description.disclosure).toEqual({ state: 'unconfirmed' });
  });

  it('時間軸の状態（未入力・非該当）は値を持たない', () => {
    expect(normalizeSsbjRiskOpportunityInput(values({ timeHorizon: 'unanswered' })).timeHorizon).toEqual({
      state: 'unanswered',
    });
    expect(normalizeSsbjRiskOpportunityInput(values({ timeHorizon: 'not_applicable' })).timeHorizon).toEqual({
      state: 'not_applicable',
    });
  });

  it('空の内部メモは null、名称は前後の空白を落とす', () => {
    const input = normalizeSsbjRiskOpportunityInput(values({ title: '  名称  ', internalNote: '   ' }));
    expect(input.title).toBe('名称');
    expect(input.description.internalNote).toBeNull();
  });

  it('リスクは選んだ種類を持ち、機会はフォームの選択に関係なく非該当にする', () => {
    expect(normalizeSsbjRiskOpportunityInput(values({ kind: 'risk', riskType: 'physical' })).riskType).toEqual({
      state: 'answered',
      value: 'physical',
    });
    expect(normalizeSsbjRiskOpportunityInput(values({ kind: 'risk', riskType: 'unconfirmed' })).riskType).toEqual({
      state: 'unconfirmed',
    });
    expect(
      normalizeSsbjRiskOpportunityInput(values({ kind: 'opportunity', riskType: 'transition' })).riskType,
    ).toEqual({ state: 'not_applicable' });
  });

  it('関連先を重複なく章の順に並べる', () => {
    const input = normalizeSsbjRiskOpportunityInput(
      values({ linkTargets: ['metrics_targets', 'strategy.b', 'strategy', 'strategy.a', 'strategy'] }),
    );
    expect(input.linkTargets).toEqual(['strategy', 'strategy.a', 'strategy.b', 'metrics_targets']);
  });
});

describe('validateSsbjRiskOpportunityInput', () => {
  it('名称が無い・入力済みなのに説明が空ならエラー', () => {
    const errors = validateSsbjRiskOpportunityInput(
      normalizeSsbjRiskOpportunityInput(values({ title: ' ', descriptionState: 'answered', descriptionText: ' ' })),
    );
    expect(errors).toContain('名称を入力してください');
    expect(errors.some(error => error.startsWith('説明を入力してください'))).toBe(true);
  });

  it('上限を超える名称はエラー', () => {
    const errors = validateSsbjRiskOpportunityInput(
      normalizeSsbjRiskOpportunityInput(values({ title: 'あ'.repeat(201) })),
    );
    expect(errors).toEqual(['名称は200文字以内で入力してください']);
  });

  it('架空データはすべて検証を通る', () => {
    for (const item of fictionalRisksOpportunities) {
      expect(validateSsbjRiskOpportunityInput(inputOf(item))).toEqual([]);
    }
  });
});

describe('関連先', () => {
  it('識別子が空なら章、あれば項目 ID、形式違いは null', () => {
    expect(toLinkTarget('strategy', '')).toBe('strategy');
    expect(toLinkTarget('strategy', ' climate_resilience ')).toBe('strategy.climate_resilience');
    expect(toLinkTarget('strategy', 'Climate')).toBeNull();
    expect(toLinkTarget('strategy', 'a.b')).toBeNull();
  });

  it('章は章名、項目は章名と ID で表示する', () => {
    expect(formatLinkTarget('strategy')).toBe('戦略');
    expect(formatLinkTarget('strategy.climate_resilience')).toBe('戦略：strategy.climate_resilience');
  });

  it('sortLinkTargets は章そのものを項目より先にする', () => {
    expect(sortLinkTargets(['governance.x', 'governance'])).toEqual(['governance', 'governance.x']);
  });
});

describe('toSsbjRiskOpportunityFormValues', () => {
  it('保存済みの内容をフォームへ戻して正規化すると元に戻る', () => {
    for (const item of fictionalRisksOpportunities) {
      const input = inputOf(item);
      expect(normalizeSsbjRiskOpportunityInput(toSsbjRiskOpportunityFormValues(input))).toEqual(input);
    }
  });
});
