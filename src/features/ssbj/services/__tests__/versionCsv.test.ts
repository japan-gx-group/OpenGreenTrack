import { describe, expect, it } from 'vitest';
import { fictionalVersion, fictionalVersionBeforeBasicInfoAdditions } from '../../__fixtures__/fictionalReport';
import { fictionalDisclosedTexts, fictionalGhgValues, fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';
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

  it('根拠文書の参照情報を項目ごとの行に分け、開示内容欄に混ぜない', () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const evidence = rows.filter(row => row[0] === '根拠文書' && row[7] === '根拠ID: 5b1f0000-1111-4000-8000-000000000201');
    expect(evidence).toHaveLength(6);
    expect(evidence.find(row => row[2] === '開示用参照文')?.[4]).toBe('取締役会の開催記録に基づく。');
    expect(evidence.find(row => row[2] === '開示用参照文')?.[6]).toBe('');
    expect(evidence.find(row => row[2] === '資料名')?.[6]).toBe('取締役会議事録（架空）');
    expect(evidence.find(row => row[2] === '保管先')?.[6]).toBe('社内共有フォルダ/議事録（架空）');
    expect(evidence.find(row => row[2] === '主管部署')?.[6]).toBe('総務部');
    expect(evidence.every(row => row.every(cell => !cell.includes('\n')))).toBe(true);
    expect(rows.filter(row => row[0] === '根拠文書')).toHaveLength(12);
  });
});

describe('ssbjVersionToCsvRows（GHG排出量）', () => {
  it('採用値を区分ごとの行にし、未算定を 0 にせず、Scope 2 の基準不明と参考値を注記する', () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const ghg = rows.filter(row => row[0] === 'GHG排出量');
    expect(ghg[0]).toEqual(['GHG排出量', fictionalVersion.reportId, '採用日時', '入力済み', '2025-06-03T02:00:00+00:00', '', '', '']);
    expect(ghg.find(row => row[1] === 'scope1')?.slice(2, 6)).toEqual(['Scope 1', '算定済み', '812.345', 't-CO2e']);
    const scope2 = ghg.find(row => row[1] === 'scope2');
    expect(scope2?.[7]).toContain('基準不明');
    expect(scope2?.[7]).toContain('基礎 120.500／調整後 1045.250／区分なし 0');
    // 直接入力で確認した結果の 0（回答済み）は 0 のまま、未算定は空欄＋「未算定」。
    expect(ghg.find(row => row[1] === 'scope3.category1')?.slice(3, 5)).toEqual(['算定済み', '0']);
    expect(ghg.some(row => row[3] === '未算定' && row[4] === '')).toBe(true);
    const reference = rows.find(row => row[0] === 'GHG排出量（参考値）');
    expect(reference?.[7]).toContain('Scope 3 の合計には含めない');
  });

  it('採用していない版は「未採用」の 1 行にする（欠落と区別する）', () => {
    const snapshot: SsbjReportSnapshotV1 = {
      ...fictionalVersion.snapshot,
      sections: { ...fictionalVersion.snapshot.sections, ghg: null },
    };
    const rows = ssbjVersionToCsvRows({ ...fictionalVersion, snapshot }, GENERATED_AT);
    expect(rows.filter(row => row[0]?.startsWith('GHG排出量'))).toEqual([
      ['GHG排出量', fictionalVersion.reportId, 'OGT の値', '未採用', '', '', '', 'OGT の候補値をレポートに採用していません'],
    ]);
  });

  it('数値が十進表記でない採用値は出力せずエラーにする', () => {
    const ghg = fictionalVersion.snapshot.sections.ghg!;
    const snapshot: SsbjReportSnapshotV1 = {
      ...fictionalVersion.snapshot,
      sections: {
        ...fictionalVersion.snapshot.sections,
        ghg: { ...ghg, values: [{ ...ghg.values[0], value: { state: 'answered', value: '1e3' } }] },
      },
    };
    expect(() => ssbjVersionToCsvRows({ ...fictionalVersion, snapshot }, GENERATED_AT)).toThrow('GHG排出量の保存内容が不正です');
  });
});

describe('ssbjVersionToCsvRows（四本柱の文章）', () => {
  it('マスターの全項目を章ごとに出し、文章の無い項目も未入力の行にする。内部メモは別列、要求 ID は注記', () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const oversight = rows.find(row => row[1] === 'governance.oversight_body' && row[2] === '監督する機関・責任者');
    expect(oversight).toEqual([
      'ガバナンス', 'governance.oversight_body', '監督する機関・責任者', '入力済み',
      '当社では、取締役会が気候関連のリスク及び機会を監督している。', '',
      '親会社のサステナビリティ委員会との関係は確認中（架空）。', '要求: REQ-GEN-001、REQ-CLM-001',
    ]);
    expect(rows.find(row => row[1] === 'governance.management_role')?.slice(3, 5)).toEqual(['未入力', '未入力']);
    expect(rows.find(row => row[1] === 'strategy.company_supplement')?.[7]).toBe('企業固有の補足');
  });
});

describe('ssbjVersionToCsvRows（該当性・重要性の判断）', () => {
  const judgementRows = (rows: string[][], requirementId: string) =>
    rows.filter(row => row[0] === '該当性・重要性の判断' && row[1] === requirementId);

  it('マスターの全要求を 4 行ずつ出し、判断の無い要求も未確認の行にする。内部の検討理由は別列', () => {
    const rows = ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);
    const clm020 = judgementRows(rows, 'REQ-CLM-020');
    expect(clm020.map(row => row.slice(2, 5))).toEqual([
      ['該当性', '入力済み', '該当'],
      ['重要性', '入力済み', '重要性あり'],
      ['記載しない理由', '入力済み', '経過措置を適用'],
      ['開示する説明', '入力済み', '適用初年度の経過措置により、スコープ 3 のカテゴリー別の内訳を開示していない。'],
    ]);
    expect(clm020[3][6]).toBe('Scope 3 の算定体制を整備中（架空）。');
    expect(clm020[0][7]).toContain('指標及び目標／気候基準');
    expect(judgementRows(rows, 'REQ-GEN-002').map(row => row.slice(2, 5))).toEqual([
      ['該当性', '未確認', '未確認'],
      ['重要性', '未確認', '未確認'],
      ['記載しない理由', '入力済み', '記載する'],
      ['開示する説明', '未入力', '未入力'],
    ]);
  });

  it('区分の値が不正な判断はエラーにする（黙って出力しない）', () => {
    const snapshot = {
      ...fictionalVersion.snapshot,
      sections: {
        ...fictionalVersion.snapshot.sections,
        judgements: [{ ...fictionalVersion.snapshot.sections.judgements![0], applicability: 'maybe' }],
      },
    } as unknown as SsbjReportSnapshotV1;
    expect(() => ssbjVersionToCsvRows({ ...fictionalVersion, snapshot }, GENERATED_AT))
      .toThrow('該当性・重要性の判断の保存内容が不正です');
  });
});

describe('ssbjVersionToCsvRows（R1 の全体確認）', () => {
  // 列: 章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記
  const DISCLOSURE = 4;
  const INTERNAL = 6;
  const rows = () => ssbjVersionToCsvRows(fictionalVersion, GENERATED_AT);

  it('入力した開示内容をすべて開示内容の列に出す（欠落しない）', () => {
    const disclosed = new Set(rows().map(row => row[DISCLOSURE]));
    expect(fictionalDisclosedTexts.length).toBeGreaterThan(10);
    expect(fictionalDisclosedTexts.filter(text => !disclosed.has(text))).toEqual([]);
  });

  it('内部記録はすべて内部記録の列に出し、開示内容の列には混ぜない', () => {
    const internal = new Set(rows().map(row => row[INTERNAL]));
    const disclosed = new Set(rows().map(row => row[DISCLOSURE]));
    expect(fictionalInternalTexts.length).toBeGreaterThan(5);
    expect(fictionalInternalTexts.filter(text => !internal.has(text))).toEqual([]);
    expect(fictionalInternalTexts.filter(text => disclosed.has(text))).toEqual([]);
  });

  it('GHG の採用値・参考値をすべて出し、回答済みの 0 と未算定を区別する', () => {
    const ghgRows = rows().filter(row => row[0]?.startsWith('GHG排出量'));
    const values = ghgRows.map(row => row[DISCLOSURE]);
    expect(fictionalGhgValues.filter(value => !values.includes(value))).toEqual([]);
    expect(ghgRows.find(row => row[1] === 'scope3.category1')?.slice(3, 5)).toEqual(['算定済み', '0']);
    expect(ghgRows.find(row => row[1] === 'scope3.category4')?.slice(3, 5)).toEqual(['未算定', '']);
  });

  it('採用値は 1 区分 1 行で、サプライヤー別の値は参考値として別の章に出す（二重加算しない）', () => {
    const ghg = fictionalVersion.snapshot.sections.ghg!;
    const adopted = rows().filter(row => row[0] === 'GHG排出量' && row[2] !== '採用日時');
    const references = rows().filter(row => row[0] === 'GHG排出量（参考値）');
    expect(adopted).toHaveLength(ghg.values.length);
    expect(new Set(adopted.map(row => row[1])).size).toBe(adopted.length);
    expect(references).toHaveLength(ghg.supplierReferences.length);
    expect(references.every(row => row[7].includes('Scope 3 の合計には含めない'))).toBe(true);
  });

  it('任意項目を追加する前の保存版でも、キーの無い基本情報を「未入力」の行にする（undefined を出さない）', () => {
    const legacyRows = ssbjVersionToCsvRows(fictionalVersionBeforeBasicInfoAdditions, GENERATED_AT);
    for (const name of ['親会社名', '親会社との関係', '親会社の持分比率（%）', '測定アプローチ', '業種（SICS）']) {
      expect(legacyRows.find(row => row[0] === '基本情報' && row[2] === name)?.slice(3, 5)).toEqual(['未入力', '']);
    }
    expect(legacyRows.flat().some(cell => cell.includes('undefined'))).toBe(false);
  });

  it('文章と判断は、入力の無い項目・要求も「未入力」「未確認」の行として出す（出力から消さない）', () => {
    const all = rows();
    expect(all.filter(row => row[0] === '該当性・重要性の判断' && row[2] === '該当性' && row[3] === '未確認').length)
      .toBeGreaterThan(0);
    expect(all.filter(row => row[1] === 'governance.management_role')[0]?.[3]).toBe('未入力');
  });
});
