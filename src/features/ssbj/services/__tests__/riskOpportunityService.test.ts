import { describe, expect, it } from 'vitest';
import { fictionalRisksOpportunities } from '../../__fixtures__/fictionalReport';
import {
  toSsbjRiskOpportunity,
  toSsbjRiskOpportunityColumns,
  type SsbjRiskOpportunityRow,
} from '../riskOpportunityService';

// DB 行 ⇔ 画面の型の変換だけを検証する（問い合わせ自体は RLS・制約を含めてマイグレーション側で確認する）。

const rowOf = (item: (typeof fictionalRisksOpportunities)[number]): SsbjRiskOpportunityRow => ({
  id: item.id,
  ...toSsbjRiskOpportunityColumns(item),
});

describe('toSsbjRiskOpportunity / toSsbjRiskOpportunityColumns', () => {
  it('架空データは列へ分解して戻すと同じになる（状態と値の対が崩れない）', () => {
    for (const item of fictionalRisksOpportunities) {
      expect(toSsbjRiskOpportunity(rowOf(item))).toEqual(item);
    }
  });

  it('入力済み以外の説明・時間軸は値の列を null にする', () => {
    const columns = toSsbjRiskOpportunityColumns(fictionalRisksOpportunities[2]);
    expect(columns).toMatchObject({
      descriptionState: 'unanswered',
      descriptionText: null,
      timeHorizonState: 'unanswered',
      timeHorizon: null,
    });
  });

  it('状態と値が食い違う行は補正せず例外にする', () => {
    const row = { ...rowOf(fictionalRisksOpportunities[2]), descriptionText: '値があるのに未入力' };
    expect(() => toSsbjRiskOpportunity(row)).toThrow();
  });

  it('不明な区分は例外にする', () => {
    expect(() => toSsbjRiskOpportunity({ ...rowOf(fictionalRisksOpportunities[0]), kind: 'threat' })).toThrow(
      '不明なリスク・機会の区分です',
    );
  });
});
