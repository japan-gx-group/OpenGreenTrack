import { describe, expect, it } from 'vitest';
import { TNFD_METRIC_CATEGORIES } from '../../types';
import { isTnfdMetricId } from '../ids';
import {
  TNFD_GHG_METRIC_IDS,
  TNFD_METRICS,
  TNFD_METRIC_MASTER_VERSION,
  findTnfdMetric,
  isTnfdGhgMetricId,
  tnfdMetricsEnabledInR1,
  tnfdMetricsOfCategory,
} from '../metricMaster';
import { findTnfdRequirement } from '../requirementMaster';

describe('指標マスター', () => {
  it('指標 ID は形式どおりで重複しない', () => {
    const ids = TNFD_METRICS.map(metric => metric.id);
    expect(ids.every(isTnfdMetricId)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('分類はすべて既知の値', () => {
    for (const metric of TNFD_METRICS) {
      expect(TNFD_METRIC_CATEGORIES).toContain(metric.category);
    }
  });

  it('ラベルと要求を持ち、要求はマスターにある', () => {
    for (const metric of TNFD_METRICS) {
      expect(metric.label.trim()).not.toBe('');
      expect(metric.requirementIds.length).toBeGreaterThan(0);
      for (const requirementId of metric.requirementIds) {
        expect(findTnfdRequirement(requirementId), `${metric.id} → ${requirementId}`).toBeDefined();
      }
    }
  });

  it('入力種別と単位が整合する（文章のみは単位なし・単位変更不可、数値は単位あり）', () => {
    for (const metric of TNFD_METRICS) {
      if (metric.inputKind === 'manual_text') {
        expect(metric.unit, metric.id).toBeNull();
        expect(metric.unitSelectable, metric.id).toBe(false);
      } else {
        expect(metric.unit, metric.id).not.toBeNull();
      }
    }
  });

  it('GHG は OGT の採用値（auto・t-CO2e・単位変更不可）で、6 本すべてがマスターにある', () => {
    const ghgIds = Object.values(TNFD_GHG_METRIC_IDS);
    expect(ghgIds).toHaveLength(6);
    for (const id of ghgIds) {
      const metric = findTnfdMetric(id);
      expect(metric, id).toBeDefined();
      expect(metric?.inputKind).toBe('auto');
      expect(metric?.unit).toBe('t-CO2e');
      expect(metric?.unitSelectable).toBe(false);
      expect(metric?.category).toBe('climate_change');
      expect(metric?.enabledInR1).toBe(true);
      expect(isTnfdGhgMetricId(id)).toBe(true);
    }
    expect(TNFD_METRICS.filter(metric => metric.inputKind === 'auto').map(metric => metric.id)).toEqual(ghgIds);
    expect(isTnfdGhgMetricId('water_withdrawal')).toBe(false);
  });

  it('October 2026 版で確定したコードを持つ', () => {
    expect(findTnfdMetric('invasive_species')?.tnfdCode).toBe('C4.0');
    expect(findTnfdMetric('ecosystem_extent')?.tnfdCode).toBe('C5.0');
    expect(findTnfdMetric('ecosystem_condition')?.tnfdCode).toBe('C5.1');
    expect(findTnfdMetric('species_extinction_risk')?.tnfdCode).toBe('C5.2');
  });

  it('ISSB 公開草案の脆弱資産の受け皿（金額・割合）は R1 で入力欄を出す', () => {
    expect(findTnfdMetric('vulnerable_assets_amount')?.enabledInR1).toBe(true);
    expect(findTnfdMetric('vulnerable_assets_share')?.enabledInR1).toBe(true);
    expect(findTnfdMetric('vulnerable_assets_share')?.unit).toBe('%');
  });

  it('R1 で入力欄を出す指標は enabledInR1 の指標と一致し、対象外の指標もマスターに残る', () => {
    const enabled = tnfdMetricsEnabledInR1();
    expect(enabled.every(metric => metric.enabledInR1)).toBe(true);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled.length).toBeLessThan(TNFD_METRICS.length);
  });

  it('分類ごとの指標はマスターの順で返る', () => {
    const pollution = tnfdMetricsOfCategory('pollution').map(metric => metric.id);
    expect(pollution).toEqual(TNFD_METRICS.filter(metric => metric.category === 'pollution').map(metric => metric.id));
    expect(pollution).toContain('waste');
    expect(tnfdMetricsOfCategory('risk_opportunity').map(metric => metric.id)).toEqual([
      'vulnerable_assets_amount',
      'vulnerable_assets_share',
    ]);
  });

  it('マスターの版を持ち、無い指標は undefined', () => {
    expect(TNFD_METRIC_MASTER_VERSION).toMatch(/\S/);
    expect(findTnfdMetric('unknown_metric')).toBeUndefined();
  });
});
