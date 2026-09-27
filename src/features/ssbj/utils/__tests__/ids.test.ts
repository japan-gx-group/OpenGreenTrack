import { describe, expect, it } from 'vitest';
import {
  isSsbjItemId,
  isSsbjRequirementId,
  isSsbjSectionId,
  sectionOfItem,
  standardOfRequirement,
} from '../ids';

describe('isSsbjSectionId', () => {
  it('四本柱の 4 値だけを受け付ける', () => {
    for (const id of ['governance', 'strategy', 'risk_management', 'metrics_targets']) {
      expect(isSsbjSectionId(id)).toBe(true);
    }
    expect(isSsbjSectionId('Governance')).toBe(false);
    expect(isSsbjSectionId('general')).toBe(false);
    expect(isSsbjSectionId(undefined)).toBe(false);
  });
});

describe('isSsbjItemId', () => {
  it.each(['governance.oversight_body', 'strategy.climate_resilience', 'metrics_targets.scope1_2'])(
    '%s は正しい形式',
    id => {
      expect(isSsbjItemId(id)).toBe(true);
    },
  );

  it.each([
    'governance',
    'governance.',
    'governance.Oversight',
    'governance.oversight-body',
    'governance.oversight.body',
    'general.oversight_body',
    ' governance.oversight_body',
    'governance.oversight_body ',
  ])('%s は不正な形式', id => {
    expect(isSsbjItemId(id)).toBe(false);
  });
});

describe('isSsbjRequirementId', () => {
  it.each(['REQ-APP-001', 'REQ-GEN-012', 'REQ-CLM-999'])('%s は正しい形式', id => {
    expect(isSsbjRequirementId(id)).toBe(true);
  });

  it.each(['REQ-CLM-1', 'REQ-CLM-0001', 'REQ-XYZ-001', 'req-clm-001', 'REQ-CLM-001a', 'CLM-001'])(
    '%s は不正な形式',
    id => {
      expect(isSsbjRequirementId(id)).toBe(false);
    },
  );
});

describe('sectionOfItem / standardOfRequirement', () => {
  it('項目 ID の接頭辞から章を返す', () => {
    expect(sectionOfItem('risk_management.process_integration')).toBe('risk_management');
  });

  it('要求 ID から基準コードを返す', () => {
    expect(standardOfRequirement('REQ-GEN-003')).toBe('GEN');
  });

  it('不正な要求 ID は例外にする', () => {
    expect(() => standardOfRequirement('REQ-CLM-1')).toThrow('要求IDの形式');
  });
});
