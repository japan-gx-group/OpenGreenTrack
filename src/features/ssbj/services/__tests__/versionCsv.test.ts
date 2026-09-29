import { describe, expect, it } from 'vitest';
import { fictionalVersion } from '../../__fixtures__/fictionalReport';
import type { SsbjReportSnapshotV1 } from '../../types';
import { ssbjVersionToCsvRows } from '../versionCsv';

const GENERATED_AT = '2025-06-04T01:02:03.000Z';

describe('ssbjVersionToCsvRows', () => {
  it('指定版の基本情報とリスク・機会を行へ変換し、内部メモを別列に置く', () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    expect(rows).toContainEqual(['版ID', fictionalVersion.id]);
    expect(rows).toContainEqual(['排出量の単位', 't-CO2e']);
    expect(rows).toContainEqual(['生成日時', GENERATED_AT]);
    expect(rows).toContainEqual([
      'リスク',
      '5b1f0000-0000-4000-8000-000000000101',
      '説明',
      '入力済み',
      '炭素価格が導入された場合、主要原材料の調達コストが上昇する可能性がある。',
      '',
      '影響額の試算は経営企画部で実施中（架空）。',
      '',
    ]);
    expect(rows.find(row => row[2] === '説明' && row[1]?.endsWith('102'))?.[4]).toBe('未確認');
    expect(rows.find(row => row[2] === '説明' && row[1]?.endsWith('103'))?.[4]).toBe('未入力');
    expect(rows.find(row => row[2] === '参照する基準の版')?.[3]).toBe('未入力');
    expect(rows.find(row => row[2] === '親会社との関係')?.[4]).toBe('連結子会社');
    expect(rows.find(row => row[2] === '測定アプローチ')?.[4]).toBe('経営支配力アプローチ');
    expect(rows.find(row => row[2] === 'リスクの種類' && row[1]?.endsWith('101'))?.[4]).toBe('移行リスク');
    expect(rows.find(row => row[2] === '短期')?.[4]).toBe('3年以内（中期経営計画の期間）');
    expect(rows.find(row => row[0] === '時間軸の定義' && row[2] === '内部メモ')?.[6])
      .toBe('計画期間との関係は経営企画部に確認中（架空）。');
  });

  it('スナップショットにない後日の変更を反映せず、同じ版は同じ行になる', () => {
    const first = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const second = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    expect(second).toEqual(first);
  });

  it('回答済みの 0 と非該当を状態と値で区別する', () => {
    const original = fictionalVersion.snapshot.sections.risks_opportunities![0];
    const snapshot: SsbjReportSnapshotV1 = {
      ...fictionalVersion.snapshot,
      sections: {
        risks_opportunities: [{
          ...original,
          description: { disclosure: { state: 'answered', value: '0' }, internalNote: null },
          timeHorizon: { state: 'not_applicable' },
        }],
      },
    };
    const rows = ssbjVersionToCsvRows({ ...fictionalVersion, snapshot }, GENERATED_AT);
    expect(rows.find(row => row[2] === '説明')?.slice(3, 5)).toEqual(['入力済み', '0']);
    expect(rows.find(row => row[2] === '時間軸')?.slice(3, 5)).toEqual(['非該当', '非該当']);
  });

  it('未対応セクションを黙って出力漏れにしない', () => {
    const snapshot = {
      ...fictionalVersion.snapshot,
      sections: { ...fictionalVersion.snapshot.sections, ghg_values: [{ value: '0' }] },
    } as unknown as SsbjReportSnapshotV1;
    expect(() => ssbjVersionToCsvRows({ ...fictionalVersion, snapshot }, GENERATED_AT)).toThrow('未対応');
  });

  it('根拠文書の内部保管先を開示内容欄に混ぜず、固定版の値だけを出す', () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const evidence = rows.find(row => row[0] === '根拠文書' && row[1] === 'governance.oversight_body');
    expect(evidence?.[4]).toBe('取締役会の開催記録に基づく。');
    expect(evidence?.[4]).not.toContain('社内共有フォルダ');
    expect(evidence?.[6]).toContain('保管先: 社内共有フォルダ/議事録（架空）');
    expect(rows.filter(row => row[0] === '根拠文書')).toHaveLength(2);
  });
});
