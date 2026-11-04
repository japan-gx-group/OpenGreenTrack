// 架空データが共通データ契約（docs/tnfd-spec.md）を満たし、境界ケースを含み続けることの確認。
// 各機能のテストがこのデータを前提にするため、値を書き換えて境界ケースが消えたらここで落とす。

import { describe, expect, it } from 'vitest';
import { isDecimalString } from '@/features/ssbj/utils/decimal';
import { fromFieldValue, toFieldValue } from '@/features/ssbj/utils/fieldValue';
import {
  FICTIONAL_FISCAL_YEAR,
  FICTIONAL_ORGANIZATION_ID,
  fictionalOgtAdoptedValues,
  fictionalReportBasicInfo as fictionalSsbjReportBasicInfo,
} from '@/features/ssbj/__fixtures__/fictionalReport';
import type { TnfdFieldValue } from '../../types';
import { TNFD_LOCATION_SENSITIVITIES, TNFD_SECTION_IDS } from '../../types';
import { isTnfdItemId, isTnfdMetricId, isTnfdRequirementId, sectionOfItem } from '../../utils/ids';
import { findTnfdMetric } from '../../utils/metricMaster';
import { TNFD_NARRATIVE_ITEMS, findTnfdRequirement } from '../../utils/requirementMaster';
import {
  FICTIONAL_TNFD_REPORT_ID,
  fictionalTnfdDisclosableTexts,
  fictionalTnfdLocationAssessments,
  fictionalTnfdMetricValues,
  fictionalTnfdNarratives,
  fictionalTnfdReportBasicInfo,
  fictionalTnfdRequirementLinks,
  fictionalTnfdSnapshot,
  fictionalTnfdVersion,
} from '../fictionalReport';

const allFieldValues = (): TnfdFieldValue<string>[] => [
  ...Object.values(fictionalTnfdDisclosableTexts).map(text => text.disclosure),
  ...fictionalTnfdMetricValues.map(metric => metric.value),
  ...fictionalTnfdMetricValues.map(metric => metric.method.disclosure),
  ...fictionalTnfdLocationAssessments.map(location => location.basis.disclosure),
];

describe('識別子', () => {
  it('項目 ID・要求 ID・指標 ID が形式どおりで、マスターに存在する', () => {
    for (const itemId of Object.keys(fictionalTnfdDisclosableTexts)) {
      expect(isTnfdItemId(itemId)).toBe(true);
      expect(TNFD_NARRATIVE_ITEMS.some(item => item.id === itemId), itemId).toBe(true);
    }
    for (const link of fictionalTnfdRequirementLinks) {
      expect(isTnfdItemId(link.itemId)).toBe(true);
      for (const id of link.requirementIds) {
        expect(isTnfdRequirementId(id)).toBe(true);
        expect(findTnfdRequirement(id), id).toBeDefined();
      }
    }
    for (const metric of fictionalTnfdMetricValues) {
      expect(isTnfdMetricId(metric.metricId)).toBe(true);
      expect(findTnfdMetric(metric.metricId), metric.metricId).toBeDefined();
    }
  });

  it('四本柱の 4 章すべてに項目がある', () => {
    const sections = new Set(
      Object.keys(fictionalTnfdDisclosableTexts).map(id => sectionOfItem(id as keyof typeof fictionalTnfdDisclosableTexts)),
    );
    expect(sections).toEqual(new Set(TNFD_SECTION_IDS));
  });

  it('1 つの文章が複数の要求（提言と一般要件）に関連付いている例と、ISSB 草案の要求に答える例を含む', () => {
    expect(fictionalTnfdRequirementLinks.some(link => link.requirementIds.length > 1)).toBe(true);
    expect(fictionalTnfdRequirementLinks.some(link => link.requirementIds.some(id => id.startsWith('REQ-ISSB-')))).toBe(
      true,
    );
  });

  it('基本情報・保存版が同じレポート・年度を指す', () => {
    expect(fictionalTnfdReportBasicInfo.id).toBe(FICTIONAL_TNFD_REPORT_ID);
    expect(fictionalTnfdSnapshot.report.id).toBe(fictionalTnfdReportBasicInfo.id);
    expect(fictionalTnfdVersion.reportId).toBe(fictionalTnfdReportBasicInfo.id);
    expect(fictionalTnfdSnapshot.report.fiscalYearId).toBe(FICTIONAL_FISCAL_YEAR.id);
    expect(fictionalTnfdSnapshot.report.periodStart).toBe(FICTIONAL_FISCAL_YEAR.startDate);
    expect(fictionalTnfdSnapshot.report.periodEnd).toBe(FICTIONAL_FISCAL_YEAR.endDate);
  });

  it('SSBJ の架空レポートと同じ組織・同じ年度（GHG の一致を確かめるため。docs/tnfd-spec.md §14）', () => {
    expect(fictionalTnfdReportBasicInfo.organizationId).toBe(FICTIONAL_ORGANIZATION_ID);
    expect(fictionalTnfdReportBasicInfo.organizationId).toBe(fictionalSsbjReportBasicInfo.organizationId);
    expect(fictionalTnfdReportBasicInfo.fiscalYearId).toBe(fictionalSsbjReportBasicInfo.fiscalYearId);
    expect(fictionalTnfdReportBasicInfo.id).not.toBe(fictionalSsbjReportBasicInfo.id);
  });
});

describe('値の状態', () => {
  it('値を持つのは回答済みの項目だけ（DB 行との往復で崩れない）', () => {
    for (const value of allFieldValues()) {
      const row = fromFieldValue(value);
      expect(toFieldValue(row.state, row.value)).toEqual(value);
    }
  });

  it('文章に 4 状態のうち回答済み・未確認・非該当を含む', () => {
    const states = new Set(Object.values(fictionalTnfdDisclosableTexts).map(text => text.disclosure.state));
    expect(states).toEqual(new Set(['answered', 'unconfirmed', 'not_applicable']));
  });

  it('開示文と内部メモの併存・内部メモだけの項目・両方なしの項目を含む', () => {
    const texts = Object.values(fictionalTnfdDisclosableTexts);
    expect(texts.some(text => text.disclosure.state === 'answered' && text.internalNote !== null)).toBe(true);
    expect(texts.some(text => text.disclosure.state !== 'answered' && text.internalNote !== null)).toBe(true);
    expect(texts.some(text => text.disclosure.state === 'answered' && text.internalNote === null)).toBe(true);
  });

  it('narratives は disclosableTexts と同じ項目・同じ中身', () => {
    expect(fictionalTnfdNarratives.map(narrative => narrative.itemId)).toEqual(Object.keys(fictionalTnfdDisclosableTexts));
    for (const narrative of fictionalTnfdNarratives) {
      expect(narrative.text).toEqual(fictionalTnfdDisclosableTexts[narrative.itemId]);
    }
  });
});

describe('コア指標', () => {
  it('数値の指標の値は十進文字列で、0 を回答済みとして含む', () => {
    for (const metric of fictionalTnfdMetricValues) {
      const definition = findTnfdMetric(metric.metricId);
      if (definition?.inputKind !== 'manual_number') continue;
      if (metric.value.state === 'answered') expect(isDecimalString(metric.value.value), metric.metricId).toBe(true);
    }
    expect(fictionalTnfdMetricValues.some(metric => metric.value.state === 'answered' && metric.value.value === '0')).toBe(
      true,
    );
  });

  it('未入力・非該当の指標を含む', () => {
    const states = new Set(fictionalTnfdMetricValues.map(metric => metric.value.state));
    expect(states.has('unanswered')).toBe(true);
    expect(states.has('not_applicable')).toBe(true);
  });

  it('単位はマスターの既定値か、単位変更可の指標で変えた値', () => {
    let changed = 0;
    for (const metric of fictionalTnfdMetricValues) {
      const definition = findTnfdMetric(metric.metricId);
      expect(definition).toBeDefined();
      if (!definition) continue;
      if (definition.inputKind === 'manual_text') {
        expect(metric.unit, metric.metricId).toBeNull();
        continue;
      }
      if (metric.unit !== definition.unit) {
        expect(definition.unitSelectable, metric.metricId).toBe(true);
        changed += 1;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('文章のみの指標と、手入力の指標はすべて組織全体・手入力の出所', () => {
    expect(
      fictionalTnfdMetricValues.some(metric => findTnfdMetric(metric.metricId)?.inputKind === 'manual_text'),
    ).toBe(true);
    for (const metric of fictionalTnfdMetricValues) {
      expect(findTnfdMetric(metric.metricId)?.inputKind).not.toBe('auto');
      expect(metric.boundary).toEqual({ kind: 'organization' });
      expect(metric.source.kind).toBe('manual');
    }
  });

  it('GHG は SSBJ の架空の採用値と同じもの（Scope 2 は基準の区別なしの値と基準別の値の両方を持つ）', () => {
    expect(fictionalTnfdSnapshot.sections.metrics?.ghg).toBe(fictionalOgtAdoptedValues);
    const scope2 = fictionalOgtAdoptedValues.find(value => value.scope === 2 && value.scope3CategoryId === null);
    expect(scope2).toBeDefined();
    expect(scope2?.value.state).toBe('answered');
    expect(scope2?.method.kind).toBe('activity_based');
    if (scope2?.method.kind === 'activity_based') {
      expect(scope2.method.basisTotals?.locationBased.state).toBe('answered');
      expect(scope2.method.basisTotals?.marketBased.state).toBe('answered');
    }
  });
});

describe('拠点の自然関連情報', () => {
  it('該当あり・該当なし・未判定を 1 件ずつ含む', () => {
    const sensitivities = fictionalTnfdLocationAssessments.map(location => location.sensitivity);
    expect(new Set(sensitivities)).toEqual(new Set(TNFD_LOCATION_SENSITIVITIES));
    expect(sensitivities).toHaveLength(TNFD_LOCATION_SENSITIVITIES.length);
  });

  it('緯度経度は十進文字列で範囲内、緯度経度なしの拠点を含む', () => {
    let missing = 0;
    for (const location of fictionalTnfdLocationAssessments) {
      if (location.latitude === null || location.longitude === null) {
        expect(location.latitude).toBeNull();
        expect(location.longitude).toBeNull();
        missing += 1;
        continue;
      }
      expect(isDecimalString(location.latitude)).toBe(true);
      expect(isDecimalString(location.longitude)).toBe(true);
      expect(Math.abs(Number(location.latitude))).toBeLessThanOrEqual(90);
      expect(Math.abs(Number(location.longitude))).toBeLessThanOrEqual(180);
    }
    expect(missing).toBeGreaterThan(0);
  });

  it('該当ありの拠点は根拠の開示文を持ち、未判定の拠点は根拠が未入力', () => {
    for (const location of fictionalTnfdLocationAssessments) {
      if (location.sensitivity === 'sensitive') expect(location.basis.disclosure.state).toBe('answered');
      if (location.sensitivity === 'unassessed') expect(location.basis.disclosure.state).toBe('unanswered');
    }
  });

  it('拠点 ID と拠点名は重複しない', () => {
    const ids = fictionalTnfdLocationAssessments.map(location => location.locationId);
    const names = fictionalTnfdLocationAssessments.map(location => location.locationName);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('保存版', () => {
  it('schemaVersion 1 で、3 セクションを持つ', () => {
    expect(fictionalTnfdSnapshot.schemaVersion).toBe(1);
    expect(Object.keys(fictionalTnfdSnapshot.sections).sort()).toEqual(
      ['location_assessments', 'metrics', 'narratives'].sort(),
    );
  });

  it('版は 1 番で、作業中の版番号と元の版を持つ', () => {
    expect(fictionalTnfdVersion.versionNumber).toBe(1);
    expect(fictionalTnfdVersion.basedOnDraftRevision).toBeGreaterThan(0);
    expect(fictionalTnfdVersion.sourceVersionId).toBeNull();
    expect(fictionalTnfdVersion.snapshot).toBe(fictionalTnfdSnapshot);
  });
});
