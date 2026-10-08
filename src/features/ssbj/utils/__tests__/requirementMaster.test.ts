import { describe, expect, it } from 'vitest';
import { SSBJ_REFERENCE_STANDARDS, SSBJ_SECTION_IDS } from '../../types';
import { isSsbjItemId, isSsbjRequirementId, sectionOfItem, standardOfRequirement } from '../ids';
import {
  SSBJ_NARRATIVE_ITEMS,
  SSBJ_REQUIREMENTS,
  SSBJ_REQUIREMENT_MASTER_VERSION,
  findSsbjRequirement,
  formatParagraphReference,
  ssbjNarrativeItemsOfSection,
  ssbjRequirementsOfItem,
} from '../requirementMaster';

describe('要求', () => {
  it('要求 ID は形式どおりで重複しない', () => {
    const ids = SSBJ_REQUIREMENTS.map(requirement => requirement.id);
    expect(ids.every(isSsbjRequirementId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('初回対象の範囲（docs/ssbj-r1-scope.md §5.1）の件数: 一般 13・気候 30・適用 4', () => {
    const count = (code: string) =>
      SSBJ_REQUIREMENTS.filter(requirement => standardOfRequirement(requirement.id) === code).length;
    expect([count('GEN'), count('CLM'), count('APP')]).toEqual([13, 30, 4]);
  });

  it('要約・記載ガイド・項番号を持ち、項番号の最初は要求 ID と同じ基準', () => {
    for (const requirement of SSBJ_REQUIREMENTS) {
      expect(requirement.summary.trim()).not.toBe('');
      expect(requirement.guide.trim()).not.toBe('');
      expect(requirement.references.length).toBeGreaterThan(0);
      expect(requirement.references[0].standard).toBe(standardOfRequirement(requirement.id));
      for (const reference of requirement.references) {
        expect(SSBJ_REFERENCE_STANDARDS).toContain(reference.standard);
        expect(reference.paragraphs.trim()).not.toBe('');
      }
    }
  });

  it('文章に答える要求は、同じ章のマスター上の項目を指し、その項目も要求を挙げている', () => {
    for (const requirement of SSBJ_REQUIREMENTS) {
      if (requirement.inputTarget.kind !== 'narrative') continue;
      const { itemId } = requirement.inputTarget;
      const item = SSBJ_NARRATIVE_ITEMS.find(candidate => candidate.id === itemId);
      expect(item, `${requirement.id} → ${itemId}`).toBeDefined();
      expect(item?.requirementIds).toContain(requirement.id);
      if (requirement.sectionId !== null) {
        expect(sectionOfItem(itemId)).toBe(requirement.sectionId);
      }
    }
  });
});

describe('文章の項目', () => {
  it('項目 ID は形式どおりで重複しない', () => {
    const ids = SSBJ_NARRATIVE_ITEMS.map(item => item.id);
    expect(ids.every(isSsbjItemId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('要求に対応する項目は 1 件以上の要求を持ち、要求側もこの項目を入力先にしている', () => {
    for (const item of SSBJ_NARRATIVE_ITEMS) {
      if (item.kind === 'company_supplement') {
        expect(item.requirementIds).toEqual([]);
        continue;
      }
      expect(item.requirementIds.length).toBeGreaterThan(0);
      for (const requirementId of item.requirementIds) {
        expect(findSsbjRequirement(requirementId)?.inputTarget).toEqual({ kind: 'narrative', itemId: item.id });
      }
    }
  });

  it('どの章にも企業固有の補足が 1 つずつある', () => {
    for (const sectionId of SSBJ_SECTION_IDS) {
      const supplements = ssbjNarrativeItemsOfSection(sectionId).filter(item => item.kind === 'company_supplement');
      expect(supplements).toHaveLength(1);
    }
  });

  it('一般基準と気候基準の共通記載を 1 つの項目で答えられる', () => {
    expect(ssbjRequirementsOfItem('governance.oversight_body').map(requirement => requirement.id))
      .toEqual(['REQ-GEN-001', 'REQ-CLM-001']);
  });

  it('記載例とラベルを持つ', () => {
    for (const item of SSBJ_NARRATIVE_ITEMS) {
      expect(item.label.trim()).not.toBe('');
      expect(item.example.trim()).not.toBe('');
    }
  });

  it('穴埋めテンプレートを持ち、自社の言葉で埋める部分（【 】）を含む', () => {
    for (const item of SSBJ_NARRATIVE_ITEMS) {
      expect(item.template, item.id).toMatch(/【[^【】]+】/);
      expect(item.template, item.id).not.toBe(item.example);
    }
  });
});

describe('補助', () => {
  it('マスターの版を持つ（保存版にどの版で作ったかを残すため）', () => {
    expect(SSBJ_REQUIREMENT_MASTER_VERSION).toMatch(/\S/);
  });

  it('項番号を基準の略称つきで表示する', () => {
    expect(formatParagraphReference({ standard: 'CLM', paragraphs: '19(2)' })).toBe('気候基準 19(2)');
    expect(formatParagraphReference({ standard: 'PRA1', paragraphs: '7〜9' })).toBe('実務対応基準第1号 7〜9');
  });

  it('マスターに無い項目の要求は空', () => {
    expect(ssbjRequirementsOfItem('governance.unknown_item')).toEqual([]);
  });
});
