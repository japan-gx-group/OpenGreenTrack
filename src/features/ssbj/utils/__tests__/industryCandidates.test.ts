import { describe, expect, it } from 'vitest';
import { isSsbjSectionId } from '../ids';
import {
  SSBJ_CANDIDATE_ID_PATTERN,
  SSBJ_INDUSTRY_CANDIDATES,
  normalizeSsbjRiskCandidateDecision,
  ssbjCandidateStatus,
  ssbjIndustryCandidatesFor,
  ssbjRiskFormValuesFromCandidate,
  validateSsbjRiskCandidateDecision,
  type SsbjRiskCandidateDecisionInput,
} from '../industryCandidates';
import { findSsbjNarrativeItem } from '../requirementMaster';
import { SICS_SECTORS } from '../sicsIndustries';

const decision = (overrides: Partial<SsbjRiskCandidateDecisionInput> = {}): SsbjRiskCandidateDecisionInput => ({
  candidateId: 'common.carbon_pricing',
  candidateVersion: 'r2-trial-1',
  industryCode: 'RT-IG',
  decision: 'adopted',
  reason: null,
  riskOpportunityId: 'risk-1',
  ...overrides,
});

describe('候補の定義', () => {
  it('候補 ID は一意で形式に合い、セクター別の ID はそのセクターの接頭辞で始まる', () => {
    const ids = SSBJ_INDUSTRY_CANDIDATES.map(candidate => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const candidate of SSBJ_INDUSTRY_CANDIDATES) {
      expect(candidate.id).toMatch(SSBJ_CANDIDATE_ID_PATTERN);
      expect(candidate.id.split('.')[0]).toBe(candidate.scope === 'common' ? 'common' : candidate.scope.toLowerCase());
    }
  });

  it('関連する項目は要求項目マスターにある項目だけ（任意の文字列を正式な項目として使わない）', () => {
    for (const candidate of SSBJ_INDUSTRY_CANDIDATES) {
      expect(candidate.linkTargets.length).toBeGreaterThan(0);
      for (const target of candidate.linkTargets) {
        expect(isSsbjSectionId(target) || findSsbjNarrativeItem(target) !== undefined).toBe(true);
      }
    }
  });

  it('リスクにはリスクの種類があり、機会には無い', () => {
    for (const candidate of SSBJ_INDUSTRY_CANDIDATES) {
      expect(candidate.riskType === null).toBe(candidate.kind === 'opportunity');
    }
  });

  it('すべての SICS のセクターに候補がある', () => {
    for (const sector of SICS_SECTORS) {
      expect(SSBJ_INDUSTRY_CANDIDATES.some(candidate => candidate.scope === sector.prefix)).toBe(true);
    }
  });
});

describe('ssbjIndustryCandidatesFor', () => {
  it('業種のセクターの候補と共通の候補を出す', () => {
    const groups = ssbjIndustryCandidatesFor('RT-IG');
    expect(groups.industryCode).toBe('RT-IG');
    expect(groups.industry.every(candidate => candidate.scope === 'RT')).toBe(true);
    expect(groups.industry.length).toBeGreaterThan(0);
    expect(groups.common.every(candidate => candidate.scope === 'common')).toBe(true);
  });

  it('業種が未選択・一覧に無いコードなら、業種の候補は出さない', () => {
    expect(ssbjIndustryCandidatesFor(null).industry).toEqual([]);
    expect(ssbjIndustryCandidatesFor('XX-YY')).toMatchObject({ industryCode: null, industry: [] });
  });
});

describe('ssbjRiskFormValuesFromCandidate', () => {
  it('名称・区分・リスクの種類・関連する項目だけを入れ、説明・時間軸は未入力のまま', () => {
    const candidate = SSBJ_INDUSTRY_CANDIDATES.find(item => item.id === 'common.acute_physical')!;
    expect(ssbjRiskFormValuesFromCandidate(candidate)).toEqual({
      kind: 'risk',
      title: candidate.title,
      riskType: 'physical',
      descriptionState: 'unanswered',
      descriptionText: '',
      internalNote: '',
      timeHorizon: 'unanswered',
      linkTargets: candidate.linkTargets,
    });
    const opportunity = SSBJ_INDUSTRY_CANDIDATES.find(item => item.kind === 'opportunity')!;
    expect(ssbjRiskFormValuesFromCandidate(opportunity).riskType).toBe('unanswered');
  });
});

describe('判断の正規化と検証', () => {
  it('理由の前後の空白を落とし、空なら null', () => {
    expect(normalizeSsbjRiskCandidateDecision(decision({ reason: '  ' })).reason).toBeNull();
    expect(normalizeSsbjRiskCandidateDecision(decision({ reason: ' 理由 ' })).reason).toBe('理由');
  });

  it('改行・タブ・全角スペース・NBSP・BOM だけの理由も空とみなし、除外を保存させない（DB の制約・差戻しの理由と同じ判定）', () => {
    for (const blank of ['\t', '\n\r\n', '\u3000\u3000', '\u00a0', '\ufeff', ' \t\u3000\n ']) {
      const normalized = normalizeSsbjRiskCandidateDecision(decision({ decision: 'excluded', riskOpportunityId: null, reason: blank }));
      expect(normalized.reason).toBeNull();
      expect(validateSsbjRiskCandidateDecision(normalized)).toEqual(['除外する理由を入力してください（後から判断の根拠を確かめるため）']);
    }
  });

  it('本文がある理由は、前後の空白だけを落として保存できる（途中の改行・全角スペースは残す）', () => {
    const normalized = normalizeSsbjRiskCandidateDecision(
      decision({ decision: 'excluded', riskOpportunityId: null, reason: '\u3000\n当社は\u3000該当設備を持たない\n\t' }),
    );
    expect(normalized.reason).toBe('当社は\u3000該当設備を持たない');
    expect(validateSsbjRiskCandidateDecision(normalized)).toEqual([]);
  });

  it('除外は理由が必須、採用は登録したリスク・機会が必須', () => {
    expect(validateSsbjRiskCandidateDecision(decision())).toEqual([]);
    expect(validateSsbjRiskCandidateDecision(decision({ decision: 'excluded', riskOpportunityId: null, reason: null })))
      .toEqual(['除外する理由を入力してください（後から判断の根拠を確かめるため）']);
    expect(validateSsbjRiskCandidateDecision(decision({ decision: 'excluded', riskOpportunityId: null, reason: '理由' })))
      .toEqual([]);
    expect(validateSsbjRiskCandidateDecision(decision({ riskOpportunityId: null }))).not.toEqual([]);
  });

  it('候補の一覧に無い候補は保存しない', () => {
    expect(validateSsbjRiskCandidateDecision(decision({ candidateId: 'common.unknown' })))
      .toContain('候補の一覧に無い候補です');
    expect(validateSsbjRiskCandidateDecision(decision({ candidateId: '自由入力' }))).toContain('候補の一覧に無い候補です');
  });
});

describe('ssbjCandidateStatus', () => {
  const saved = { ...decision(), updatedAt: '2025-06-01T00:00:00.000Z' };
  it('判断と登録済みのリスク・機会から状態を決める', () => {
    expect(ssbjCandidateStatus(undefined, new Set())).toBe('undecided');
    expect(ssbjCandidateStatus(saved, new Set(['risk-1']))).toBe('adopted');
    expect(ssbjCandidateStatus(saved, new Set())).toBe('adopted_removed');
    expect(ssbjCandidateStatus({ ...saved, decision: 'excluded', reason: '理由', riskOpportunityId: null }, new Set()))
      .toBe('excluded');
  });
});
