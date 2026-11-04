import { describe, expect, it } from 'vitest';
import { TNFD_SECTION_IDS, TNFD_STANDARD_CODES } from '../../types';
import { isTnfdItemId, isTnfdRequirementId, sectionOfItem, standardOfRequirement } from '../ids';
import { findTnfdMetric } from '../metricMaster';
import {
  TNFD_NARRATIVE_ITEMS,
  TNFD_REQUIREMENTS,
  TNFD_REQUIREMENT_MASTER_VERSION,
  findTnfdRequirement,
  formatParagraphReference,
  tnfdNarrativeItemsOfSection,
  tnfdRequirementsOfItem,
} from '../requirementMaster';

describe('要求', () => {
  it('要求 ID は形式どおりで重複しない', () => {
    const ids = TNFD_REQUIREMENTS.map(requirement => requirement.id);
    expect(ids.every(isTnfdRequirementId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('件数: TNFD は 14 提言＋一般要件 7、ISSB 公開草案の新要求 3（docs/tnfd-spec.md 別表A）', () => {
    const count = (code: string) =>
      TNFD_REQUIREMENTS.filter(requirement => standardOfRequirement(requirement.id) === code).length;
    expect([count('TNFD'), count('ISSB')]).toEqual([21, 3]);
    const recommendations = TNFD_REQUIREMENTS.filter(
      requirement => standardOfRequirement(requirement.id) === 'TNFD' && requirement.sectionId !== null,
    );
    expect(recommendations).toHaveLength(14);
  });

  it('四本柱の各章に提言がある（ガバナンス 3・戦略 4・リスクとインパクトの管理 4・指標と目標 3）', () => {
    const count = (sectionId: string) =>
      TNFD_REQUIREMENTS.filter(
        requirement => standardOfRequirement(requirement.id) === 'TNFD' && requirement.sectionId === sectionId,
      ).length;
    expect(TNFD_SECTION_IDS.map(count)).toEqual([3, 4, 4, 3]);
  });

  it('要約・記載ガイド・参照を持ち、参照の最初は要求 ID と同じ基準', () => {
    for (const requirement of TNFD_REQUIREMENTS) {
      expect(requirement.summary.trim()).not.toBe('');
      expect(requirement.guide.trim()).not.toBe('');
      expect(requirement.references.length).toBeGreaterThan(0);
      expect(requirement.references[0].standard).toBe(standardOfRequirement(requirement.id));
      for (const reference of requirement.references) {
        expect(TNFD_STANDARD_CODES).toContain(reference.standard);
        expect(reference.paragraphs.trim()).not.toBe('');
      }
    }
  });

  it('文章に答える要求は、同じ章のマスター上の項目を指し、その項目も要求を挙げている', () => {
    for (const requirement of TNFD_REQUIREMENTS) {
      if (requirement.inputTarget.kind !== 'narrative') continue;
      const { itemId } = requirement.inputTarget;
      const item = TNFD_NARRATIVE_ITEMS.find(candidate => candidate.id === itemId);
      expect(item, `${requirement.id} → ${itemId}`).toBeDefined();
      expect(item?.requirementIds).toContain(requirement.id);
      if (requirement.sectionId !== null) {
        expect(sectionOfItem(itemId)).toBe(requirement.sectionId);
      }
    }
  });

  it('指標で答える要求は、指標マスターにある指標を指し、その指標も要求を挙げている', () => {
    for (const requirement of TNFD_REQUIREMENTS) {
      if (requirement.inputTarget.kind !== 'metric') continue;
      expect(requirement.inputTarget.metricIds.length).toBeGreaterThan(0);
      for (const metricId of requirement.inputTarget.metricIds) {
        const metric = findTnfdMetric(metricId);
        expect(metric, `${requirement.id} → ${metricId}`).toBeDefined();
        expect(metric?.requirementIds).toContain(requirement.id);
      }
    }
  });

  it('ISSB 公開草案の 3 要求は、ロケーション・シナリオ分析・脆弱資産に 1 つずつ対応する', () => {
    const issb = TNFD_REQUIREMENTS.filter(requirement => standardOfRequirement(requirement.id) === 'ISSB');
    expect(issb.map(requirement => requirement.inputTarget.kind)).toEqual(['location', 'narrative', 'metric']);
  });

  it('環境犯罪（October 2026 版の追加）は R1 では注記で扱う', () => {
    expect(findTnfdRequirement('REQ-TNFD-021')?.inputTarget).toEqual({ kind: 'notice' });
  });
});

describe('文章の項目', () => {
  it('項目 ID は形式どおりで重複しない', () => {
    const ids = TNFD_NARRATIVE_ITEMS.map(item => item.id);
    expect(ids.every(isTnfdItemId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('要求に対応する項目は 1 件以上の要求を持ち、要求側もこの項目を入力先にしている', () => {
    for (const item of TNFD_NARRATIVE_ITEMS) {
      if (item.kind === 'company_supplement') {
        expect(item.requirementIds).toEqual([]);
        continue;
      }
      expect(item.requirementIds.length).toBeGreaterThan(0);
      for (const requirementId of item.requirementIds) {
        expect(findTnfdRequirement(requirementId)?.inputTarget).toEqual({ kind: 'narrative', itemId: item.id });
      }
    }
  });

  it('ISSB 受け皿の項目は ISSB の要求だけに答える（TNFD の提言と混ぜない）', () => {
    for (const item of TNFD_NARRATIVE_ITEMS) {
      if (item.kind !== 'issb_placeholder') continue;
      expect(item.requirementIds.length).toBeGreaterThan(0);
      item.requirementIds.forEach(id => expect(standardOfRequirement(id)).toBe('ISSB'));
    }
  });

  it('どの章にも企業固有の補足が 1 つずつある', () => {
    for (const sectionId of TNFD_SECTION_IDS) {
      const supplements = tnfdNarrativeItemsOfSection(sectionId).filter(item => item.kind === 'company_supplement');
      expect(supplements).toHaveLength(1);
    }
  });

  it('提言と一般要件の同じ趣旨の要求を 1 つの項目で答えられる', () => {
    expect(tnfdRequirementsOfItem('governance.human_rights_engagement').map(requirement => requirement.id)).toEqual([
      'REQ-TNFD-003',
      'REQ-TNFD-020',
    ]);
  });

  it('記載例とラベルを持つ', () => {
    for (const item of TNFD_NARRATIVE_ITEMS) {
      expect(item.label.trim()).not.toBe('');
      expect(item.example.trim()).not.toBe('');
    }
  });
});

describe('補助', () => {
  it('マスターの版を持つ（保存版にどの版で作ったかを残すため）', () => {
    expect(TNFD_REQUIREMENT_MASTER_VERSION).toMatch(/\S/);
  });

  it('参照を基準の略称つきで表示する', () => {
    expect(formatParagraphReference({ standard: 'TNFD', paragraphs: 'Governance A' })).toBe('TNFD 提言 Governance A');
    expect(formatParagraphReference({ standard: 'ISSB', paragraphs: 'ED-2026-10: location information' })).toBe(
      'ISSB 草案 ED-2026-10: location information',
    );
  });

  it('マスターに無い項目の要求は空', () => {
    expect(tnfdRequirementsOfItem('governance.unknown_item')).toEqual([]);
  });
});
