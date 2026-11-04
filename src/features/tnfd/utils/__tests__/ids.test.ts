import { describe, expect, it } from 'vitest';
import {
  isTnfdItemId,
  isTnfdMetricId,
  isTnfdRequirementId,
  isTnfdSectionId,
  sectionOfItem,
  standardOfRequirement,
} from '../ids';

describe('isTnfdSectionId', () => {
  it('四本柱の 4 値だけを受け付ける（SSBJ の risk_management とは別の値）', () => {
    for (const id of ['governance', 'strategy', 'risk_impact_management', 'metrics_targets']) {
      expect(isTnfdSectionId(id)).toBe(true);
    }
    expect(isTnfdSectionId('risk_management')).toBe(false);
    expect(isTnfdSectionId('Governance')).toBe(false);
    expect(isTnfdSectionId('general')).toBe(false);
    expect(isTnfdSectionId(undefined)).toBe(false);
  });
});

describe('isTnfdItemId', () => {
  it.each([
    'governance.board_oversight',
    'strategy.priority_locations',
    'risk_impact_management.direct_operations_process',
    'metrics_targets.targets',
  ])('%s は正しい形式', id => {
    expect(isTnfdItemId(id)).toBe(true);
  });

  it.each([
    'governance',
    'governance.',
    'governance.Board',
    'governance.board-oversight',
    'governance.board.oversight',
    'risk_management.integration',
    'general.scope',
    ' governance.board_oversight',
    'governance.board_oversight ',
  ])('%s は不正な形式', id => {
    expect(isTnfdItemId(id)).toBe(false);
  });
});

describe('isTnfdRequirementId', () => {
  it.each(['REQ-TNFD-001', 'REQ-TNFD-021', 'REQ-ISSB-003'])('%s は正しい形式', id => {
    expect(isTnfdRequirementId(id)).toBe(true);
  });

  it.each(['REQ-TNFD-1', 'REQ-TNFD-0001', 'REQ-GEN-001', 'REQ-CLM-001', 'req-tnfd-001', 'TNFD-001', ''])(
    '%s は不正な形式',
    id => {
      expect(isTnfdRequirementId(id)).toBe(false);
    },
  );
});

describe('isTnfdMetricId', () => {
  it.each(['ghg_scope1', 'water_withdrawal', 'ghg_scope2_location_based', 'c4'])('%s は正しい形式', id => {
    expect(isTnfdMetricId(id)).toBe(true);
  });

  it.each(['C4.0', '4_invasive', 'water-withdrawal', 'Water', '', 'ghg scope1'])('%s は不正な形式', id => {
    expect(isTnfdMetricId(id)).toBe(false);
  });
});

describe('sectionOfItem', () => {
  it('項目 ID の接頭辞から章を返す', () => {
    expect(sectionOfItem('governance.board_oversight')).toBe('governance');
    expect(sectionOfItem('risk_impact_management.integration')).toBe('risk_impact_management');
  });

  it('不正な項目 ID は例外', () => {
    expect(() => sectionOfItem('general.scope' as never)).toThrow('項目IDの形式が正しくありません');
  });
});

describe('standardOfRequirement', () => {
  it('要求 ID の基準コードを返す', () => {
    expect(standardOfRequirement('REQ-TNFD-007')).toBe('TNFD');
    expect(standardOfRequirement('REQ-ISSB-002')).toBe('ISSB');
  });

  it('不正な要求 ID は例外', () => {
    expect(() => standardOfRequirement('REQ-GEN-001' as never)).toThrow('要求IDの形式が正しくありません');
  });
});
