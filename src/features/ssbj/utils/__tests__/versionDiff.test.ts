import { describe, expect, it } from 'vitest';
import {
  fictionalGhgAdoption,
  fictionalJudgements,
  fictionalNarratives,
  fictionalRisksOpportunities,
  fictionalSnapshot,
} from '../../__fixtures__/fictionalReport';
import type { SsbjReportSnapshotV1, SsbjSnapshotSections } from '../../types';
import { toSsbjDisclosedSnapshot } from '../disclosedSnapshot';
import {
  defaultSsbjCompareVersions,
  diffSsbjSnapshots,
  diffSsbjText,
  orderSsbjCompareVersions,
  splitSsbjGraphemes,
  splitSsbjSentences,
  type SsbjTextDiffPart,
} from '../versionDiff';

/** 差分の片から、前の文章と後の文章を組み立て直す。 */
const rebuild = (parts: SsbjTextDiffPart[]) => ({
  before: parts.filter(part => part.kind !== 'added').map(part => part.text).join(''),
  after: parts.filter(part => part.kind !== 'removed').map(part => part.text).join(''),
});

const withSections = (sections: Partial<SsbjSnapshotSections>, base: SsbjReportSnapshotV1 = fictionalSnapshot): SsbjReportSnapshotV1 => ({
  ...base,
  sections: { ...base.sections, ...sections },
});

describe('splitSsbjSentences', () => {
  it('句点・感嘆符・疑問符・改行で区切り、区切りの文字は前の文に含める（つなぐと元に戻る）', () => {
    const text = '取締役会が監督する。年2回報告する！\n頻度は？\n\n最後の文';
    const sentences = splitSsbjSentences(text);
    expect(sentences).toEqual(['取締役会が監督する。', '年2回報告する！\n', '頻度は？\n', '\n', '最後の文']);
    expect(sentences.join('')).toBe(text);
    expect(splitSsbjSentences('')).toEqual([]);
  });
});

describe('diffSsbjText', () => {
  it('同じ文章は 1 つの same', () => {
    expect(diffSsbjText('同じ文。', '同じ文。')).toEqual([{ kind: 'same', text: '同じ文。' }]);
    expect(diffSsbjText('', '')).toEqual([]);
  });

  it('変わった文の中だけ、文字の単位で追加・削除を出す', () => {
    const parts = diffSsbjText(
      '取締役会が監督する。炭素価格の導入により、物流費が上がると見込んでいる。',
      '取締役会が監督する。炭素価格の導入により、物流費が年間で約3％上がると見込んでいる。',
    );
    expect(parts).toEqual([
      { kind: 'same', text: '取締役会が監督する。炭素価格の導入により、物流費が' },
      { kind: 'added', text: '年間で約3％' },
      { kind: 'same', text: '上がると見込んでいる。' },
    ]);
  });

  it('文の追加・削除は文の単位で出し、変わらない文はそのまま残す', () => {
    const parts = diffSsbjText('一つ目の文。二つ目の文。三つ目の文。', '一つ目の文。三つ目の文。四つ目の文。');
    expect(parts).toEqual([
      { kind: 'same', text: '一つ目の文。' },
      { kind: 'removed', text: '二つ目の文。' },
      { kind: 'same', text: '三つ目の文。' },
      { kind: 'added', text: '四つ目の文。' },
    ]);
  });

  it('空の文章との差分は、すべて追加かすべて削除', () => {
    expect(diffSsbjText('', '新しい文。')).toEqual([{ kind: 'added', text: '新しい文。' }]);
    expect(diffSsbjText('消えた文。', '')).toEqual([{ kind: 'removed', text: '消えた文。' }]);
  });

  it('つなぐと前後の文章に戻る（絵文字などサロゲートペアも割らない）', () => {
    const cases: [string, string][] = [
      ['水を🌊使う。年2回確認する。', '水を💧使う。年3回確認する。追記。'],
      ['あいうえお\nかきくけこ', 'あいうXえお\nかきこ'],
      ['ABC', 'XYZ'],
    ];
    for (const [before, after] of cases) {
      expect(rebuild(diffSsbjText(before, after))).toEqual({ before, after });
    }
  });

  it('ZWJ でつないだ絵文字や肌の色の絵文字を途中で割らず、1 文字として追加・削除を出す', () => {
    const family = '👨\u200D👩\u200D👧';
    const parts = diffSsbjText(`家族${family}で参加する。`, '家族👍🏽で参加する。');
    expect(parts).toEqual([
      { kind: 'same', text: '家族' },
      { kind: 'removed', text: family },
      { kind: 'added', text: '👍🏽' },
      { kind: 'same', text: 'で参加する。' },
    ]);
    // 同じ ZWJ の絵文字の後ろだけ変えたときも、絵文字は same のまま残る。
    expect(diffSsbjText(`${family}A。`, `${family}B。`)).toEqual([
      { kind: 'same', text: family },
      { kind: 'removed', text: 'A' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: '。' },
    ]);
  });

  it('Intl.Segmenter が無い環境では、コードポイント（サロゲートペアは割らない）で分ける', () => {
    expect(splitSsbjGraphemes('a👨\u200D👩', null)).toEqual(['a', '👨', '\u200D', '👩']);
    expect(splitSsbjGraphemes('a👨\u200D👩')).toEqual(['a', '👨\u200D👩']);
  });

  it('長い文章（数千文字の文が多数）でも短い時間で終わる', () => {
    const sentence = (index: number) => `${'気候関連のリスク及び機会について取締役会が監督する'.repeat(3)}${index}。`;
    const before = Array.from({ length: 300 }, (_, index) => sentence(index)).join('');
    const after = before.replace(sentence(150), `${sentence(150)}追加した文。`).replace(sentence(10), '');
    const started = performance.now();
    const parts = diffSsbjText(before, after);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(rebuild(parts)).toEqual({ before, after });
    expect(parts.filter(part => part.kind === 'added').map(part => part.text).join('')).toBe('追加した文。');
  });

  it('1 つの巨大なかたまりでも、文字の差分を取らずに削除と追加を並べて終わる', () => {
    const before = 'あ'.repeat(3000);
    const after = 'い'.repeat(3000);
    const parts = diffSsbjText(before, after);
    expect(parts).toEqual([{ kind: 'removed', text: before }, { kind: 'added', text: after }]);
  });
});

describe('diffSsbjSnapshots', () => {
  it('同じ版どうしは変更なし', () => {
    expect(diffSsbjSnapshots(fictionalSnapshot, fictionalSnapshot)).toEqual({ changes: [], uncompared: [] });
  });

  it('文章は項目の名前（要求項目マスター）と項目 ID を添え、文字の差分を出す', () => {
    const after = withSections({
      narratives: fictionalNarratives.map(narrative => narrative.itemId === 'governance.oversight_body'
        ? { ...narrative, text: { ...narrative.text, disclosure: { state: 'answered', value: '当社では、取締役会が年2回、気候関連のリスク及び機会を監督している。' } } }
        : narrative),
    });
    const { changes } = diffSsbjSnapshots(fictionalSnapshot, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ group: 'ガバナンス・戦略等の文章', title: '監督する機関・責任者', id: 'governance.oversight_body', status: 'changed' });
    expect(changes[0].fields).toEqual([{
      kind: 'text',
      label: '開示する文章',
      parts: [
        { kind: 'same', text: '当社では、取締役会が' },
        { kind: 'added', text: '年2回、' },
        { kind: 'same', text: '気候関連のリスク及び機会を監督している。' },
      ],
    }]);
  });

  it('文章の状態の変化（未確認 → 入力済み）や、行の無い項目への入力は「前 → 後」で出す', () => {
    const after = withSections({
      narratives: [
        ...fictionalNarratives.map(narrative => narrative.itemId === 'strategy.business_model_impact'
          ? { ...narrative, text: { ...narrative.text, disclosure: { state: 'answered' as const, value: '物流費が上がる。' } } }
          : narrative),
        { itemId: 'governance.oversight_information', text: { disclosure: { state: 'answered', value: '年2回報告する。' }, internalNote: null } },
      ],
    });
    const { changes } = diffSsbjSnapshots(fictionalSnapshot, after);
    expect(changes.map(change => change.id)).toEqual(['governance.oversight_information', 'strategy.business_model_impact']);
    expect(changes[0].fields).toEqual([{ kind: 'value', label: '開示する文章', before: '未入力', after: '年2回報告する。' }]);
    expect(changes[1].fields).toEqual([{ kind: 'value', label: '開示する文章', before: '未確認', after: '物流費が上がる。' }]);
  });

  it('判断は要求の要約と要求 ID を添え、該当性などを「前 → 後」で出す。行が無い要求は未確認と比べる', () => {
    const changed = { ...fictionalJudgements[0], applicability: 'not_applicable' as const };
    const after = withSections({
      judgements: [changed, ...fictionalJudgements.slice(1), { ...fictionalJudgements[0], requirementId: 'REQ-CLM-001', applicability: 'applicable' as const }],
    });
    const { changes } = diffSsbjSnapshots(fictionalSnapshot, after);
    const byId = new Map(changes.map(change => [change.id, change]));
    expect(byId.get(fictionalJudgements[0].requirementId)?.fields).toContainEqual({
      kind: 'value', label: '該当性', before: '該当', after: '非該当',
    });
    expect(byId.get('REQ-CLM-001')).toMatchObject({ group: '該当性・重要性の判断', status: 'changed' });
    expect(byId.get('REQ-CLM-001')?.fields).toContainEqual({ kind: 'value', label: '該当性', before: '未確認', after: '該当' });
  });

  it('リスク・機会は ID で対応を取り、増えた・消えた項目を出す', () => {
    const [first, ...rest] = fictionalRisksOpportunities;
    const added = { ...first, id: '5b1f0000-0000-4000-8000-0000000001ff', title: '新しいリスク' };
    const { changes } = diffSsbjSnapshots(fictionalSnapshot, withSections({ risks_opportunities: [...rest, added] }));
    expect(changes.map(change => [change.title, change.status])).toEqual([
      ['新しいリスク', 'added'],
      [first.title, 'removed'],
    ]);
    expect(changes[0].fields).toContainEqual({ kind: 'value', label: '名称', before: '（なし）', after: '新しいリスク' });
  });

  it('GHG の採用値は区分ごとに「前 → 後」で出し、採用日時の違いだけでは変化にしない', () => {
    const values = fictionalGhgAdoption.values.map(value => value.scope === 1 && value.scope3CategoryId === null
      ? { ...value, value: { state: 'answered' as const, value: '900.5' }, adoptedAt: '2025-07-01T00:00:00.000Z' }
      : { ...value, adoptedAt: '2025-07-01T00:00:00.000Z' });
    const after = withSections({ ghg: { ...fictionalGhgAdoption, adoptedAt: '2025-07-01T00:00:00.000Z', values } });
    const { changes } = diffSsbjSnapshots(fictionalSnapshot, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ group: 'GHG排出量（OGT の採用値）', title: 'Scope 1' });
    expect(changes[0].fields).toEqual([{ kind: 'value', label: '採用値', before: '812.345 t-CO2e', after: '900.5 t-CO2e' }]);
  });

  it('GHG を採用していない版からの比較は、採用した区分を増えたものとして出す', () => {
    const { changes } = diffSsbjSnapshots(withSections({ ghg: null }), fictionalSnapshot);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.every(change => change.status === 'added')).toBe(true);
  });

  it('基本情報の変化を出す', () => {
    const after = { ...fictionalSnapshot, report: { ...fictionalSnapshot.report, reportingScope: '架空サンプル株式会社（連結）' } };
    const { changes } = diffSsbjSnapshots(fictionalSnapshot, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ group: '基本情報', title: '基本情報' });
    expect(changes[0].fields[0]).toMatchObject({ kind: 'text', label: '報告範囲' });
  });

  it('内部メモを除いた版どうしでは、内部メモだけの変化を出さない', () => {
    const after = withSections({
      narratives: fictionalNarratives.map(narrative => ({ ...narrative, text: { ...narrative.text, internalNote: '書き換えた内部メモ' } })),
    });
    expect(diffSsbjSnapshots(fictionalSnapshot, after).changes.length).toBeGreaterThan(0);
    const disclosed = diffSsbjSnapshots(
      toSsbjDisclosedSnapshot(fictionalSnapshot).snapshot,
      toSsbjDisclosedSnapshot(after).snapshot,
    );
    expect(disclosed.changes).toEqual([]);
  });

  it('片方の版にしか無いセクション（項目を足す前の保存版）は比べず、名前を返す', () => {
    const sections = { ...fictionalSnapshot.sections };
    delete sections.external_emissions;
    const older = { ...fictionalSnapshot, sections };
    expect(diffSsbjSnapshots(older, fictionalSnapshot)).toEqual({ changes: [], uncompared: ['外部で算定した排出量'] });
  });
});

describe('defaultSsbjCompareVersions', () => {
  const versions = [
    { id: 'v4', versionNumber: 4, createdAt: '2025-11-17T00:12:00.000Z' },
    { id: 'v3', versionNumber: 3, createdAt: '2025-11-15T08:30:00.000Z' },
    { id: 'v2', versionNumber: 2, createdAt: '2025-11-10T02:05:00.000Z' },
  ];

  it('最新のレビュー依頼より前の最後の版 → 最新の版', () => {
    expect(defaultSsbjCompareVersions(versions, '2025-11-15T09:00:00.000Z')).toEqual({ fromId: 'v3', toId: 'v4', basis: 'request' });
    expect(defaultSsbjCompareVersions(versions, '2025-11-12T00:00:00.000Z')).toEqual({ fromId: 'v2', toId: 'v4', basis: 'request' });
  });

  it('依頼の時点が分からない・依頼より前の版が無い・依頼の後に版が無いときは、1 つ前の版 → 最新の版', () => {
    const previous = { fromId: 'v3', toId: 'v4', basis: 'previous' };
    expect(defaultSsbjCompareVersions(versions, null)).toEqual(previous);
    expect(defaultSsbjCompareVersions(versions, '2025-11-01T00:00:00.000Z')).toEqual(previous);
    expect(defaultSsbjCompareVersions(versions, '2025-11-18T00:00:00.000Z')).toEqual(previous);
  });

  it('並びに関わらず版番号で決め、版が 2 つ未満なら null', () => {
    expect(defaultSsbjCompareVersions([...versions].reverse(), null)).toEqual({ fromId: 'v3', toId: 'v4', basis: 'previous' });
    expect(defaultSsbjCompareVersions(versions.slice(0, 1), null)).toBeNull();
  });
});

describe('orderSsbjCompareVersions', () => {
  const versions = [{ id: 'v4', versionNumber: 4 }, { id: 'v2', versionNumber: 2 }];

  it('前の版に新しい版を選んでも、版番号の小さい順に入れ替えて比べる', () => {
    expect(orderSsbjCompareVersions(versions, 'v4', 'v2')).toEqual({ fromId: 'v2', toId: 'v4', swapped: true });
    expect(orderSsbjCompareVersions(versions, 'v2', 'v4')).toEqual({ fromId: 'v2', toId: 'v4', swapped: false });
  });

  it('同じ版や一覧に無い版は、選んだ順のまま', () => {
    expect(orderSsbjCompareVersions(versions, 'v4', 'v4')).toEqual({ fromId: 'v4', toId: 'v4', swapped: false });
    expect(orderSsbjCompareVersions(versions, 'v9', 'v2')).toEqual({ fromId: 'v9', toId: 'v2', swapped: false });
  });
});
