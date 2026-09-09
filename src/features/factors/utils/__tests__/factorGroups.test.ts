import { describe, expect, it } from 'vitest';
import { ENERGY_VALUE_BY_LABEL, type EmissionFactor } from '../../services/factorService';
import {
  FACTOR_GROUPS,
  FACTOR_GROUP_BY_ENERGY,
  FACTOR_GROUP_ENERGY_FIELD_LABELS,
  energyLabelsInGroup,
  factorGroupOf,
} from '../factorGroups';

describe('FACTOR_GROUP_BY_ENERGY', () => {
  // 種別を足したのに群を足し忘れると、その係数がどちらのタブにも意図せず現れる
  // （factorGroupOf のフォールバックで黙って活動側へ落ちる）。
  it('係数管理が扱うエネルギー種別ラベルを漏れなく分類する', () => {
    const labels = Object.keys(ENERGY_VALUE_BY_LABEL) as EmissionFactor['energyType'][];

    for (const label of labels) {
      expect(FACTOR_GROUP_BY_ENERGY[label], `${label} の群が未定義`).toBeDefined();
    }
    expect(Object.keys(FACTOR_GROUP_BY_ENERGY).sort()).toEqual(labels.sort());
  });

  it('物理量ベースの燃料種は燃料側、活動量ベースの Scope 3 係数は活動側に分ける', () => {
    expect(factorGroupOf('電気')).toBe('fuel');
    expect(factorGroupOf('ガス')).toBe('fuel');
    expect(factorGroupOf('軽油')).toBe('fuel');
    expect(factorGroupOf('燃料（その他）')).toBe('fuel');

    // この issue の発端: エネルギーでないものが「エネルギー種別」として並んでいた
    expect(factorGroupOf('水道')).toBe('activity');
    expect(factorGroupOf('輸送')).toBe('activity');
    expect(factorGroupOf('出張')).toBe('activity');
    expect(factorGroupOf('購入した製品・サービス')).toBe('activity');
    expect(factorGroupOf('廃棄物')).toBe('activity');
  });
});

describe('energyLabelsInGroup', () => {
  it('渡した候補の順序を保ったまま、その群のラベルだけを返す', () => {
    const labels: EmissionFactor['energyType'][] = ['電気', '水道', 'ガス', '出張'];

    expect(energyLabelsInGroup('fuel', labels)).toEqual(['電気', 'ガス']);
    expect(energyLabelsInGroup('activity', labels)).toEqual(['水道', '出張']);
  });

  it('2 群を合わせると元の候補に戻る（どの候補もどちらかのタブから必ず選べる）', () => {
    const labels = Object.keys(ENERGY_VALUE_BY_LABEL) as EmissionFactor['energyType'][];
    const split = FACTOR_GROUPS.flatMap((group) => energyLabelsInGroup(group, labels));

    expect(split.slice().sort()).toEqual(labels.slice().sort());
  });
});

describe('FACTOR_GROUP_ENERGY_FIELD_LABELS', () => {
  it('燃料側だけが「エネルギー種別」を名乗る', () => {
    expect(FACTOR_GROUP_ENERGY_FIELD_LABELS.fuel).toBe('エネルギー種別');
    expect(FACTOR_GROUP_ENERGY_FIELD_LABELS.activity).not.toContain('エネルギー');
  });
});
