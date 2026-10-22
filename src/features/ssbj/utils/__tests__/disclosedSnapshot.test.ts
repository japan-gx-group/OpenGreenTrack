// 保存版から内部メモ・内部記録を除く純関数のテスト。閲覧者に返す内容に内部記録が混ざらないことと、
// 保存版の項目・セクションがすべて「開示する」か「内部記録」に分類されていること（足し忘れの検出）を確かめる。

import { describe, expect, it } from 'vitest';
import {
  FICTIONAL_BATCH_ID,
  FICTIONAL_USER_ID,
  fictionalSnapshot,
  fictionalVersionBeforeBasicInfoAdditions,
  fictionalVersionBeforeRiskType,
} from '../../__fixtures__/fictionalReport';
import {
  SSBJ_SNAPSHOT_SECTION_KEYS,
  fictionalDisclosedTexts,
  fictionalGhgValues,
  fictionalInternalTexts,
} from '../../__fixtures__/fictionalReportTexts';
import type { SsbjReportSnapshotV1 } from '../../types';
import { SSBJ_SNAPSHOT_FIELD_CLASSIFICATION, toSsbjDisclosedSnapshot, type SsbjFieldClassification } from '../disclosedSnapshot';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 値の中のすべての葉のパス（入れ子は `.`、配列の要素は `[]`）。分類の表と同じ書き方。 */
const leafPaths = (value: unknown, prefix = ''): string[] => {
  if (Array.isArray(value)) return value.flatMap(item => leafPaths(item, `${prefix}[]`));
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
};

/** パスが分類のどれかに当たるか（分類したパスそのものか、その下の項目）。 */
const isClassified = (path: string, classification: SsbjFieldClassification): boolean =>
  [...classification.disclosed, ...classification.internal].some(classified =>
    path === classified || path.startsWith(`${classified}.`) || path.startsWith(`${classified}[]`));

/** セクションの要素（配列のセクション）か、セクションそのもの（オブジェクトのセクション）の葉のパス。 */
const sectionLeafPaths = (section: unknown): string[] =>
  Array.isArray(section) ? section.flatMap(item => leafPaths(item)) : leafPaths(section);

describe('toSsbjDisclosedSnapshot', () => {
  const { snapshot: disclosed, unclassifiedPaths } = toSsbjDisclosedSnapshot(fictionalSnapshot);
  const json = JSON.stringify(disclosed);

  it('内部メモ・内部記録（資料名・保管先・ファイルの照合用の記録など）を 1 つも残さない', () => {
    expect(fictionalInternalTexts.length).toBeGreaterThan(0);
    for (const text of fictionalInternalTexts) expect(json, text).not.toContain(text);
    // 架空データの内部記録のうち、fictionalInternalTexts に入れていないもの（記録日時・採用者・算定バッチ・件数）。
    for (const text of ['2025-06-01T01:00:00.000Z', FICTIONAL_USER_ID, FICTIONAL_BATCH_ID]) {
      expect(json, text).not.toContain(text);
    }
    for (const key of ['internalNote', 'documentTitle', 'internalLocation', 'fileSha256', 'adoptedBy', 'coverage', 'source']) {
      expect(json, key).not.toContain(`"${key}"`);
    }
  });

  it('開示する内容と GHG の数値はすべて残し、分類に無い項目は無い', () => {
    for (const text of [...fictionalDisclosedTexts, ...fictionalGhgValues]) expect(json, text).toContain(text);
    expect(disclosed.report).toEqual(fictionalSnapshot.report);
    expect(disclosed.schemaVersion).toBe(1);
    expect(unclassifiedPaths).toEqual([]);
  });

  it('読む側が使う形を保つ（開示する値は元のまま、内部記録はキーごと除く）', () => {
    const sections = disclosed.sections;
    expect(sections.narratives?.[0]).toEqual({ itemId: 'governance.oversight_body', text: { disclosure: fictionalSnapshot.sections.narratives![0].text.disclosure } });
    expect(sections.time_horizons).toEqual({
      shortTerm: fictionalSnapshot.sections.time_horizons!.shortTerm,
      mediumTerm: fictionalSnapshot.sections.time_horizons!.mediumTerm,
      longTerm: fictionalSnapshot.sections.time_horizons!.longTerm,
      planningHorizonRelation: fictionalSnapshot.sections.time_horizons!.planningHorizonRelation,
    });
    expect(sections.evidence?.map(item => Object.keys(item).sort())).toEqual([
      ['disclosure', 'id', 'itemId'], ['disclosure', 'id', 'itemId'],
    ]);
    expect(sections.ghg?.values).toHaveLength(fictionalSnapshot.sections.ghg!.values.length);
    expect(sections.ghg?.values[1].method).toEqual(fictionalSnapshot.sections.ghg!.values[1].method);
    expect(sections.ghg?.supplierReferences).toEqual(fictionalSnapshot.sections.ghg!.supplierReferences);
    expect(sections.judgements?.map(item => item.requirementId)).toEqual(
      fictionalSnapshot.sections.judgements!.map(item => item.requirementId),
    );
  });

  it('元の保存版を書き換えない', () => {
    const before = JSON.stringify(fictionalSnapshot);
    toSsbjDisclosedSnapshot(fictionalSnapshot);
    expect(JSON.stringify(fictionalSnapshot)).toBe(before);
  });

  it('項目を足す前の保存版（キーが無い）もそのまま扱う', () => {
    for (const version of [fictionalVersionBeforeBasicInfoAdditions, fictionalVersionBeforeRiskType]) {
      const result = toSsbjDisclosedSnapshot(version.snapshot);
      expect(result.unclassifiedPaths).toEqual([]);
      expect(JSON.stringify(result.snapshot)).not.toContain('internalNote');
    }
  });

  it('採用していない GHG（null）は null のまま残す', () => {
    const snapshot: SsbjReportSnapshotV1 = { ...fictionalSnapshot, sections: { ghg: null } };
    expect(toSsbjDisclosedSnapshot(snapshot).snapshot.sections).toEqual({ ghg: null });
  });

  it('分類に無い項目・セクションは閲覧者に出さず、除いた場所を返す', () => {
    const snapshot = {
      ...fictionalSnapshot,
      extra: 'x',
      report: { ...fictionalSnapshot.report, approverMemo: '内部の確認メモ' },
      sections: {
        ...fictionalSnapshot.sections,
        narratives: [{ ...fictionalSnapshot.sections.narratives![0], reviewerNote: '内部の確認メモ' }],
        external_emissions: [{ value: '1', internalNote: '内部の確認メモ' }],
      },
    } as unknown as SsbjReportSnapshotV1;
    const result = toSsbjDisclosedSnapshot(snapshot);
    expect(JSON.stringify(result.snapshot)).not.toContain('内部の確認メモ');
    expect(result.snapshot.sections).not.toHaveProperty('external_emissions');
    expect(result.unclassifiedPaths).toEqual([
      'extra', 'report.approverMemo', 'sections.external_emissions', 'sections.narratives[].reviewerNote',
    ]);
  });
});

describe('SSBJ_SNAPSHOT_FIELD_CLASSIFICATION（分類の足し忘れの検出）', () => {
  const { report, sections } = SSBJ_SNAPSHOT_FIELD_CLASSIFICATION;

  it('架空の保存版にすべてのセクションがあり、どれも分類されている（セクションを足したら分類にも足す）', () => {
    expect(Object.keys(fictionalSnapshot.sections).sort()).toEqual([...SSBJ_SNAPSHOT_SECTION_KEYS].sort());
    expect(Object.keys(sections).sort()).toEqual(Object.keys(fictionalSnapshot.sections).sort());
  });

  it('基本情報のすべての項目が、開示する・内部記録のどちらかに分類されている', () => {
    const missing = leafPaths(fictionalSnapshot.report).filter(path => !isClassified(path, report));
    expect(missing).toEqual([]);
  });

  it.each(Object.entries(fictionalSnapshot.sections))(
    '%s: すべての項目が、開示する・内部記録のどちらかに分類されている（項目を足したら分類にも足す）',
    (key, section) => {
      const classification = sections[key as keyof typeof sections];
      const paths = sectionLeafPaths(section);
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.filter(path => !isClassified(path, classification))).toEqual([]);
    },
  );

  it('同じ項目を開示する・内部記録の両方に入れていない', () => {
    for (const classification of [report, ...Object.values(sections)]) {
      expect(classification.disclosed.filter(path => classification.internal.includes(path))).toEqual([]);
    }
  });

  it('内部記録には、内部メモと根拠文書の内部記録を入れている（docs/ssbj-spec.md §5）', () => {
    expect(sections.narratives.internal).toContain('text.internalNote');
    expect(sections.judgements.internal).toContain('explanation.internalNote');
    expect(sections.risks_opportunities.internal).toContain('description.internalNote');
    expect(sections.time_horizons.internal).toContain('internalNote');
    expect(sections.evidence.disclosed).toEqual(['id', 'itemId', 'disclosure']);
  });
});
