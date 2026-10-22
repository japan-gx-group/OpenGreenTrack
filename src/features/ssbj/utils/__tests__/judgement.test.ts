import { describe, expect, it } from 'vitest';
import { fictionalJudgements, fictionalRisksOpportunities } from '../../__fixtures__/fictionalReport';
import type { SsbjJudgement } from '../../types';
import {
  applySsbjJudgementQuickChange,
  emptySsbjJudgement,
  isSsbjJudgementPending,
  isSsbjJudgementRecorded,
  isSsbjOmissionStatementMissing,
  normalizeSsbjJudgementInput,
  ssbjJudgementEntries,
  ssbjJudgementReviewReasons,
  ssbjJudgementStatus,
  ssbjRisksByRequirement,
  toSsbjJudgementFormValues,
  validateSsbjJudgementInput,
  type SsbjJudgementFormValues,
} from '../judgement';
import { SSBJ_REQUIREMENTS } from '../requirementMaster';

const values = (overrides: Partial<SsbjJudgementFormValues> = {}): SsbjJudgementFormValues => ({
  ...toSsbjJudgementFormValues(emptySsbjJudgement('REQ-CLM-020')),
  ...overrides,
});

describe('入力の正規化と検証', () => {
  it('入力済みのときだけ説明の本文を残し、前後の空白を落とし、空の内部理由は null にする', () => {
    expect(normalizeSsbjJudgementInput('REQ-CLM-020', values({
      explanationState: 'answered', explanationText: ' 経過措置を適用した。 ', internalReason: '  ',
    })).explanation).toEqual({ disclosure: { state: 'answered', value: '経過措置を適用した。' }, internalNote: null });
    expect(normalizeSsbjJudgementInput('REQ-CLM-020', values({
      explanationState: 'unconfirmed', explanationText: '下書き', internalReason: '確認中',
    })).explanation).toEqual({ disclosure: { state: 'unconfirmed' }, internalNote: '確認中' });
  });

  it('既定のまま（すべて未確認）は検証を通る（判断を強制しない）', () => {
    expect(validateSsbjJudgementInput(emptySsbjJudgement('REQ-CLM-020'))).toEqual([]);
  });

  it('「重要性がない」を理由にするなら、重要性は「重要性なし」でなければならない', () => {
    const judgement = normalizeSsbjJudgementInput('REQ-CLM-020', values({ omissionReason: 'not_material', materiality: 'material' }));
    expect(validateSsbjJudgementInput(judgement).join()).toContain('重要性を「重要性なし」にしてください');
    expect(validateSsbjJudgementInput({ ...judgement, materiality: 'not_material' })).toEqual([]);
  });

  it('「その他」「商業上の機密」で記載しないなら、内部の検討理由が要る', () => {
    for (const omissionReason of ['other', 'commercial_sensitivity'] as const) {
      const judgement = normalizeSsbjJudgementInput('REQ-GEN-004', values({ omissionReason }));
      expect(validateSsbjJudgementInput(judgement).join(), omissionReason).toContain('内部の検討理由を書いてください');
      const withReason = normalizeSsbjJudgementInput('REQ-GEN-004', values({ omissionReason, internalReason: '検討した' }));
      expect(validateSsbjJudgementInput(withReason), omissionReason).toEqual([]);
    }
  });

  it('入力済みなのに説明が空、マスターに無い要求はエラー', () => {
    const empty = normalizeSsbjJudgementInput('REQ-CLM-020', values({ explanationState: 'answered', explanationText: ' ' }));
    expect(validateSsbjJudgementInput(empty).join()).toContain('開示する説明を入力してください');
    expect(validateSsbjJudgementInput(emptySsbjJudgement('REQ-CLM-999'))).toContain('要求項目マスターに無い要求です');
  });

  it('保存済みの判断からフォームへ戻し、正規化すると元に戻る', () => {
    for (const judgement of fictionalJudgements) {
      expect(normalizeSsbjJudgementInput(judgement.requirementId, toSsbjJudgementFormValues(judgement))).toEqual(judgement);
    }
  });
});

describe('判断の状態', () => {
  it('該当性が未確認、または該当なのに重要性が未確認なら判断が済んでいない（非該当は重要性の判断不要）', () => {
    const base = emptySsbjJudgement('REQ-CLM-020');
    expect(isSsbjJudgementPending(base)).toBe(true);
    expect(isSsbjJudgementPending({ ...base, applicability: 'applicable' })).toBe(true);
    expect(isSsbjJudgementPending({ ...base, applicability: 'applicable', materiality: 'material' })).toBe(false);
    expect(isSsbjJudgementPending({ ...base, applicability: 'not_applicable' })).toBe(false);
  });

  it('既定のままなら記録なし、どれか 1 つでも変えれば記録あり', () => {
    const base = emptySsbjJudgement('REQ-CLM-020');
    expect(isSsbjJudgementRecorded(base)).toBe(false);
    expect(isSsbjJudgementRecorded({ ...base, explanation: { ...base.explanation, internalNote: 'メモ' } })).toBe(true);
    // 内部の検討理由を除いた保存版（キーが無い）は、内部の検討理由が無いものとして扱う。
    expect(isSsbjJudgementRecorded({ ...base, explanation: { disclosure: base.explanation.disclosure } } as SsbjJudgement)).toBe(false);
  });

  it('経過措置・商業上の機密で記載しないのに説明が入力済みでなければ知らせる', () => {
    const base: SsbjJudgement = { ...emptySsbjJudgement('REQ-CLM-020'), omissionReason: 'transition_relief' };
    expect(isSsbjOmissionStatementMissing(base)).toBe(true);
    expect(isSsbjOmissionStatementMissing({
      ...base, explanation: { disclosure: { state: 'answered', value: '経過措置を適用した。' }, internalNote: null },
    })).toBe(false);
    expect(isSsbjOmissionStatementMissing({ ...base, omissionReason: 'not_material', materiality: 'not_material' })).toBe(false);
  });
});

describe('ssbjJudgementEntries', () => {
  it('マスターの全要求をマスターの順に並べ、判断の無い要求は未確認にする（欠落させない）', () => {
    const entries = ssbjJudgementEntries(fictionalJudgements);
    expect(entries.map(entry => entry.judgement.requirementId)).toEqual(SSBJ_REQUIREMENTS.map(requirement => requirement.id));
    expect(entries.find(entry => entry.judgement.requirementId === 'REQ-CLM-020')?.judgement.omissionReason)
      .toBe('transition_relief');
    expect(entries.find(entry => entry.judgement.requirementId === 'REQ-GEN-002')?.judgement)
      .toEqual(emptySsbjJudgement('REQ-GEN-002'));
  });

  it('マスターに無い要求の判断は最後に足し、黙って落とさない', () => {
    const extra = emptySsbjJudgement('REQ-CLM-999');
    const entries = ssbjJudgementEntries([...fictionalJudgements, extra]);
    expect(entries.at(-1)).toEqual({ requirement: null, judgement: extra });
  });
});

describe('判断の状態（未判断・要確認・判断済み）', () => {
  const base = emptySsbjJudgement('REQ-GEN-002');
  const withNote = (judgement: SsbjJudgement): SsbjJudgement => ({
    ...judgement, explanation: { ...judgement.explanation, internalNote: '根拠' },
  });

  it('何も記録していなければ未判断', () => {
    expect(ssbjJudgementStatus(base)).toBe('undecided');
    expect(ssbjJudgementReviewReasons(base)).toEqual([]);
  });

  it('該当性・重要性を選んでも、根拠が無ければ要確認（一覧の選択で根拠を省いたことにしない）', () => {
    const chosen = applySsbjJudgementQuickChange(base, { applicability: 'applicable', materiality: 'material' });
    expect(ssbjJudgementStatus(chosen)).toBe('needs_review');
    expect(ssbjJudgementReviewReasons(chosen)).toEqual(['根拠が未入力']);
    expect(ssbjJudgementStatus(withNote(chosen))).toBe('decided');
  });

  it('該当なのに重要性が未確認、該当性が未確認、記載しない旨の説明が無ければ要確認', () => {
    expect(ssbjJudgementReviewReasons(withNote({ ...base, applicability: 'applicable' }))).toEqual(['重要性が未確認']);
    expect(ssbjJudgementReviewReasons(withNote(base))).toEqual(['該当性が未確認']);
    expect(ssbjJudgementReviewReasons(withNote({
      ...base, applicability: 'applicable', materiality: 'material', omissionReason: 'transition_relief',
    }))).toEqual(['その旨の説明が未入力']);
  });

  it('非該当なら重要性の判断は要らない。根拠は開示する説明でもよい', () => {
    expect(ssbjJudgementStatus(withNote({ ...base, applicability: 'not_applicable' }))).toBe('decided');
    expect(ssbjJudgementStatus({
      ...base, applicability: 'not_applicable', explanation: { disclosure: { state: 'answered', value: '説明' }, internalNote: null },
    })).toBe('decided');
  });
});

describe('applySsbjJudgementQuickChange', () => {
  it('選んだ値だけを変え、記載しない理由・説明・内部の検討理由はそのまま残す', () => {
    const saved: SsbjJudgement = {
      requirementId: 'REQ-CLM-020', applicability: 'applicable', materiality: 'material', omissionReason: 'transition_relief',
      explanation: { disclosure: { state: 'answered', value: '説明' }, internalNote: '根拠' },
    };
    expect(applySsbjJudgementQuickChange(saved, { materiality: 'unconfirmed' })).toEqual({ ...saved, materiality: 'unconfirmed' });
    expect(applySsbjJudgementQuickChange(saved, {})).toEqual(saved);
  });
});

describe('ssbjRisksByRequirement', () => {
  it('関連付けたマスターの項目が答える要求ごとに引き、章全体・マスターに無い項目は含めない', () => {
    const [risk] = fictionalRisksOpportunities;
    const map = ssbjRisksByRequirement([
      { ...risk, linkTargets: ['strategy', 'strategy.business_model_impact', 'strategy.climate_resilience'] },
    ]);
    expect([...map.keys()]).toEqual(['REQ-GEN-007', 'REQ-CLM-009']);
    expect(map.get('REQ-CLM-009')?.map(item => item.id)).toEqual([risk.id]);
  });
});
