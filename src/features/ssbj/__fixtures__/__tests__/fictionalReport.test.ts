// 架空データが共通データ契約（docs/ssbj-spec.md）を満たし、境界ケースを含み続けることの確認。
// 各機能のテストがこのデータを前提にするため、値を書き換えて境界ケースが消えたらここで落とす。

import { describe, expect, it } from 'vitest';
import { isDecimalString } from '../../utils/decimal';
import { fromFieldValue, toFieldValue } from '../../utils/fieldValue';
import { isSsbjItemId, isSsbjRequirementId, isSsbjSectionId, sectionOfItem } from '../../utils/ids';
import { checkOgtCandidateValue } from '../../utils/ogtValue';
import type { SsbjFieldValue } from '../../types';
import {
  FICTIONAL_FISCAL_YEAR,
  fictionalDisclosableTexts,
  fictionalGhgAdoption,
  fictionalOgtAdoptedValues,
  fictionalOgtCandidates,
  fictionalReportBasicInfo,
  fictionalRequirementLinks,
  fictionalRisksOpportunities,
  fictionalSnapshot,
  fictionalSupplierReferences,
  fictionalTimeHorizonDefinitions,
  fictionalVersion,
} from '../fictionalReport';

const allFieldValues = (): SsbjFieldValue<string>[] => [
  ...Object.values(fictionalDisclosableTexts).map(text => text.disclosure),
  ...fictionalOgtCandidates.map(candidate => candidate.value),
  ...fictionalRisksOpportunities.map(item => item.description.disclosure),
  ...fictionalRisksOpportunities.map(item => item.timeHorizon),
  ...fictionalRisksOpportunities.map(item => item.riskType),
  fictionalTimeHorizonDefinitions.shortTerm,
  fictionalTimeHorizonDefinitions.mediumTerm,
  fictionalTimeHorizonDefinitions.longTerm,
  fictionalTimeHorizonDefinitions.planningHorizonRelation,
];

describe('識別子', () => {
  it('項目 ID・要求 ID が形式どおり', () => {
    for (const itemId of Object.keys(fictionalDisclosableTexts)) {
      expect(isSsbjItemId(itemId)).toBe(true);
    }
    for (const link of fictionalRequirementLinks) {
      expect(isSsbjItemId(link.itemId)).toBe(true);
      link.requirementIds.forEach(id => expect(isSsbjRequirementId(id)).toBe(true));
    }
  });

  it('四本柱の 4 章すべてに項目がある（R1 の仮置きの範囲）', () => {
    const sections = new Set(
      Object.keys(fictionalDisclosableTexts).map(id => sectionOfItem(id as keyof typeof fictionalDisclosableTexts)),
    );
    expect(sections).toEqual(new Set(['governance', 'strategy', 'risk_management', 'metrics_targets']));
  });

  it('1 つの文章が複数の要求項目に関連付いている例を含む', () => {
    expect(fictionalRequirementLinks.some(link => link.requirementIds.length > 1)).toBe(true);
  });

  it('基本情報・保存版が同じレポート・年度を指す', () => {
    expect(fictionalSnapshot.report.id).toBe(fictionalReportBasicInfo.id);
    expect(fictionalVersion.reportId).toBe(fictionalReportBasicInfo.id);
    expect(fictionalSnapshot.report.fiscalYearId).toBe(FICTIONAL_FISCAL_YEAR.id);
    expect(fictionalSnapshot.report.periodStart).toBe(FICTIONAL_FISCAL_YEAR.startDate);
    expect(fictionalSnapshot.report.periodEnd).toBe(FICTIONAL_FISCAL_YEAR.endDate);
  });
});

describe('値の状態', () => {
  it('値を持つのは回答済みの項目だけ（DB 行との往復で崩れない）', () => {
    for (const value of allFieldValues()) {
      const row = fromFieldValue(value);
      expect(toFieldValue(row.state, row.value)).toEqual(value);
    }
  });

  it('境界ケース（回答済みの 0 / 未入力 / 未確認 / 非該当）をすべて含む', () => {
    const values = allFieldValues();
    expect(values).toContainEqual({ state: 'answered', value: '0' });
    expect(values).toContainEqual({ state: 'unanswered' });
    expect(values).toContainEqual({ state: 'unconfirmed' });
    expect(values).toContainEqual({ state: 'not_applicable' });
  });
});

describe('開示文と内部記録', () => {
  it('開示文と内部メモを両方持つ文章を含む', () => {
    expect(
      Object.values(fictionalDisclosableTexts).some(
        text => text.disclosure.state === 'answered' && text.internalNote !== null,
      ),
    ).toBe(true);
  });

  it('開示文に内部メモの内容が混ざっていない', () => {
    for (const text of Object.values(fictionalDisclosableTexts)) {
      if (text.disclosure.state === 'answered' && text.internalNote) {
        expect(text.disclosure.value).not.toContain(text.internalNote);
      }
    }
  });
});

describe('リスク・機会', () => {
  it('リスクと機会の両方を含む', () => {
    expect(new Set(fictionalRisksOpportunities.map(item => item.kind))).toEqual(new Set(['risk', 'opportunity']));
  });

  it('関連先は章 ID か項目 ID の形式', () => {
    for (const target of fictionalRisksOpportunities.flatMap(item => item.linkTargets)) {
      expect(isSsbjSectionId(target) || isSsbjItemId(target)).toBe(true);
    }
  });

  it('文章の項目への関連付け・章だけへの関連付け・関連なしの例を含む', () => {
    const targets = fictionalRisksOpportunities.flatMap(item => item.linkTargets);
    expect(targets.some(target => target in fictionalDisclosableTexts)).toBe(true);
    expect(targets.some(target => isSsbjSectionId(target))).toBe(true);
    expect(fictionalRisksOpportunities.some(item => item.linkTargets.length === 0)).toBe(true);
  });

  it('リスクの種類は、リスクには物理的 / 移行（または未入力・未確認）、機会には非該当', () => {
    for (const item of fictionalRisksOpportunities) {
      if (item.kind === 'opportunity') {
        expect(item.riskType).toEqual({ state: 'not_applicable' });
      } else {
        expect(item.riskType.state).not.toBe('not_applicable');
      }
    }
    expect(fictionalRisksOpportunities.some(item => item.riskType.state === 'answered')).toBe(true);
  });

  it('保存版の例に含まれる', () => {
    expect(fictionalSnapshot.sections.risks_opportunities).toEqual(fictionalRisksOpportunities);
    expect(fictionalSnapshot.sections.time_horizons).toEqual(fictionalTimeHorizonDefinitions);
  });
});

describe('OGT の値', () => {
  it('候補値・採用値が契約を満たす', () => {
    for (const value of [...fictionalOgtCandidates, ...fictionalOgtAdoptedValues]) {
      expect(checkOgtCandidateValue(value)).toEqual([]);
    }
  });

  it('Scope 2 は基準不明（OGT 由来で location/market を設定しない）', () => {
    const scope2 = fictionalOgtCandidates.filter(candidate => candidate.scope === 2);
    expect(scope2.length).toBeGreaterThan(0);
    for (const candidate of scope2) {
      if (candidate.scope === 2) expect(candidate.method.scope2Basis).toBe('unknown');
    }
  });

  it('Scope 3 の未算定カテゴリを含み、その値は未入力', () => {
    const notCalculated = fictionalOgtCandidates.filter(
      candidate => candidate.scope === 3 && candidate.dataQuality === 'not_calculated',
    );
    expect(notCalculated.length).toBeGreaterThan(0);
    notCalculated.forEach(candidate => expect(candidate.value).toEqual({ state: 'unanswered' }));
  });

  it('サプライヤー別実排出量は参考値として別に持ち、十進文字列', () => {
    for (const reference of fictionalSupplierReferences) {
      expect(reference.kind).toBe('supplier_reference');
      expect(isDecimalString(reference.emissions)).toBe(true);
    }
  });
});

describe('OGT の採用値一式（T08b）', () => {
  it('候補値をまとめて採用した形で、採用日時・採用者が各値とそろい、保存版の例に含まれる', () => {
    expect(fictionalGhgAdoption.values).toHaveLength(fictionalOgtCandidates.length);
    for (const value of fictionalGhgAdoption.values) {
      expect(value.adoptedAt).toBe(fictionalGhgAdoption.adoptedAt);
      expect(value.adoptedBy).toBe(fictionalGhgAdoption.adoptedBy);
    }
    expect(fictionalGhgAdoption.supplierReferences).toEqual(fictionalSupplierReferences);
    expect(fictionalSnapshot.sections.ghg).toEqual(fictionalGhgAdoption);
  });
});
