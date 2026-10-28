// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import {
  fictionalExternalEmissions,
  fictionalRisksOpportunities,
  fictionalSnapshot,
  fictionalVersion,
  fictionalVersionBeforeBasicInfoAdditions,
  fictionalVersionBeforeRiskType,
} from '../../__fixtures__/fictionalReport';
import { fictionalDisclosedTexts, fictionalGhgValues, fictionalInternalTexts } from '../../__fixtures__/fictionalReportTexts';
import type { SsbjPreviewSource } from '../../services/previewService';
import type { SsbjReportSnapshotV1 } from '../../types';
import { formatDecimalForDisplay } from '../../utils/decimal';
import { SsbjPreviewDocument } from '../SsbjPreviewDocument';

let rendered: RenderResult | null = null;
afterEach(() => { rendered?.unmount(); rendered = null; });

const working = (snapshot: SsbjReportSnapshotV1 = fictionalSnapshot): SsbjPreviewSource =>
  ({ kind: 'working', draftRevision: 7, snapshot });
const saved: SsbjPreviewSource = {
  kind: 'version',
  versionId: fictionalVersion.id,
  versionNumber: fictionalVersion.versionNumber,
  createdAt: fictionalVersion.createdAt,
  snapshot: fictionalVersion.snapshot,
};
const text = () => rendered?.container.textContent ?? '';

describe('SsbjPreviewDocument', () => {
  it('作業中か保存版かを先頭に出す', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-source"]')?.textContent)
      .toContain('作業中の内容（保存版になっていない変更を含みます。作業中の版数 7）');
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes={false} />);
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-source"]')?.textContent)
      .toContain(`保存版 第1版`);
    expect(text()).toContain(fictionalVersion.id);
  });

  it('未入力・未確認を状態のラベルで出し、空欄や 0 にしない', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).toContain('未確認');
    expect(text()).toContain('未入力');
    expect(text()).toContain('関連付けなし');
  });

  it('内部メモは既定で出さず、選んだときだけ「開示しない」と明示して出す', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).not.toContain('影響額の試算は経営企画部で実施中（架空）。');
    expect(text()).not.toContain('内部メモ（開示しない）');
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes />);
    expect(text()).toContain('内部メモ（開示しない）');
    expect(text()).toContain('影響額の試算は経営企画部で実施中（架空）。');
  });

  it('採用した GHG の値を出し、未算定を 0 にせず、参考値は合計に含めないと注記する', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).toContain('812.345 t-CO2e');
    expect(text()).toContain('未算定');
    expect(text()).toContain('サプライヤー別排出量は参考値であり、Scope 3 の合計には含めていません');
  });

  it('外部算定値の項目が無い古い版は「この版には含まれていません」、採用していなければその旨を出す', () => {
    const withoutExternal = { ...fictionalSnapshot.sections };
    delete withoutExternal.external_emissions;
    rendered = render(<SsbjPreviewDocument source={working({ ...fictionalSnapshot, sections: withoutExternal })} showInternalNotes={false} />);
    expect(text()).toContain('この版には含まれていません。');
    rendered.unmount();
    rendered = render(
      <SsbjPreviewDocument source={working({ ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, external_emissions: [] } })} showInternalNotes={false} />,
    );
    expect(text()).toContain('外部で算定した排出量は採用していません。');
  });

  it('外部算定値にロケーション基準の Scope 2 があっても、文書全体にロケーション基準の値が無いとは書かない', () => {
    // OGT のロケーション基準の値が算定済みなら CO2 の外部算定値は二重計上で入れられないので、基準別の値を取り込む前の版で確かめる。
    const ghg = fictionalSnapshot.sections.ghg!;
    const values = ghg.values.map(value => {
      if (value.scope !== 2) return value;
      const method = { ...value.method };
      delete method.basisTotals;
      return { ...value, method };
    });
    const locationBased = {
      ...fictionalExternalEmissions[0],
      id: '5b1f0000-1111-4000-8000-000000000502', scope: 2 as const, scope2Basis: 'location' as const, gases: ['CO2' as const], value: '300.000',
    };
    const snapshot = {
      ...fictionalSnapshot,
      sections: { ...fictionalSnapshot.sections, ghg: { ...ghg, values }, external_emissions: [...fictionalExternalEmissions, locationBased] },
    };
    rendered = render(<SsbjPreviewDocument source={working(snapshot)} showInternalNotes={false} />);
    expect(text()).toContain('Scope 2（ロケーション基準）');
    expect(text()).toContain('300.000');
    expect(text()).not.toContain('ロケーション基準の値を含みません');
    expect(text()).not.toContain('ロケーション基準の値は含みません');
    const notes = [...rendered.container.querySelectorAll('li')].map(node => node.textContent ?? '');
    expect(notes).toContain(
      'OGT の Scope 2 算定値は、ロケーション基準・マーケット基準を区別していません（基準不明）。基準ごとの Scope 2 は、「外部で算定した排出量」に示したものだけです。',
    );
  });

  it('Scope 2 の基準別の値を出し、注記を含まれる内容に合わせる', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).toContain('ロケーション基準1,150.000 t-CO2e');
    expect(text()).toContain('マーケット基準1,172.400 t-CO2e');
    expect(text()).toContain('うち契約したメニューの係数による分1,045.250 t-CO2e');
    expect(text()).toContain('ロケーション基準・マーケット基準の値と、温対法の係数区分による基準の区別のない値を併記しています');
    expect(text()).toContain('「外部で算定した排出量」の Scope 2 は、OGT の値とは別に示しています');
    expect(text()).not.toContain('ロケーション基準の値は含みません');
  });

  it('基準別の値を取り込む前の保存版は、OGT の値に基準の区別が無く、基準別の値は外部算定値だけと注記する', () => {
    const ghg = fictionalSnapshot.sections.ghg!;
    const values = ghg.values.map(value => {
      if (value.scope !== 2) return value;
      const method = { ...value.method };
      delete method.basisTotals;
      return { ...value, method };
    });
    rendered = render(<SsbjPreviewDocument
      source={working({ ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, ghg: { ...ghg, values } } })}
      showInternalNotes={false} />);
    expect(text()).toContain('基準ごとの Scope 2 は、「外部で算定した排出量」に示したものだけです');
    expect(text()).not.toContain('Scope 2 の基準別');
  });

  it('GHG を採用していない（null）場合と、GHG の項目が無い古い版を区別する', () => {
    rendered = render(
      <SsbjPreviewDocument source={working({ ...fictionalSnapshot, sections: { ...fictionalSnapshot.sections, ghg: null } })} showInternalNotes={false} />,
    );
    expect(text()).toContain('OGT の値はまだ採用されていません');
    rendered.unmount();
    const withoutGhg = { ...fictionalSnapshot.sections };
    delete withoutGhg.ghg;
    rendered = render(<SsbjPreviewDocument source={working({ ...fictionalSnapshot, sections: withoutGhg })} showInternalNotes={false} />);
    expect(text()).toContain('この版には温室効果ガス排出量の項目が含まれていません');
  });

  it('表示に対応していないセクションは黙って落とさず、名前を出す', () => {
    const snapshot = {
      ...fictionalSnapshot,
      sections: { ...fictionalSnapshot.sections, future_section: [] },
    } as unknown as SsbjReportSnapshotV1;
    rendered = render(<SsbjPreviewDocument source={working(snapshot)} showInternalNotes={false} />);
    const alert = rendered.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('future_section');
  });

  it('任意項目を追加する前の保存版でも、キーの無い基本情報を「未入力」と出す（印刷も同じ部品で描く）', () => {
    const legacy = fictionalVersionBeforeBasicInfoAdditions;
    rendered = render(<SsbjPreviewDocument source={{ ...saved, snapshot: legacy.snapshot }} showInternalNotes={false} />);
    const valueOf = (label: string) =>
      Array.from(rendered?.container.querySelectorAll('dt') ?? []).find(item => item.textContent === label)
        ?.nextElementSibling?.textContent;
    for (const label of ['親会社名', '親会社との関係', '親会社の持分比率', '測定アプローチ', '業種（SICS）']) {
      expect(valueOf(label)).toBe('未入力');
    }
    expect(text()).not.toContain('undefined');
  });

  it('リスクの種類を追加する前の保存版でも、落ちずにリスクの種類を「未入力」と出す（印刷も同じ部品で描く）', () => {
    const legacy = fictionalVersionBeforeRiskType;
    rendered = render(<SsbjPreviewDocument source={{ ...saved, snapshot: legacy.snapshot }} showInternalNotes={false} />);
    const riskTypeValues = Array.from(rendered.container.querySelectorAll('dt'))
      .filter(item => item.textContent === 'リスクの種類')
      .map(item => item.nextElementSibling?.textContent);
    const riskCount = fictionalRisksOpportunities.filter(item => item.kind === 'risk').length;
    expect(riskCount).toBeGreaterThan(0);
    expect(riskTypeValues).toEqual(Array(riskCount).fill('未入力'));
    expect(text()).not.toContain('undefined');
  });

  it('準拠や提出の完了を保証しない注記を必ず出す', () => {
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes={false} />);
    expect(text()).toContain('SSBJ 基準への準拠や、対外提出の完了を保証しません');
  });
});

describe('SsbjPreviewDocument（根拠文書）', () => {
  it('開示用参照文は常に出し、資料名・保管先などの内部記録は選んだときだけ出す', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).toContain('取締役会の開催記録に基づく。');
    expect(text()).toContain('未確認');
    expect(text()).not.toContain('社内共有フォルダ/議事録（架空）');
    expect(rendered.container.querySelector('[role="alert"]')).toBeNull();
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes />);
    expect(text()).toContain('保管先（内部記録・開示しない）');
    expect(text()).toContain('社内共有フォルダ/議事録（架空）');
  });

  it('ファイルの SHA-256・保管先での版などは内部記録として、選んだときだけ出す', () => {
    const sha256 = '592e812efee3d49cad9db811408e3e9ce2736f7da4ec7d90a21f0c262dc6a239';
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes={false} />);
    expect(text()).not.toContain(sha256);
    expect(text()).not.toContain('取締役会議事録_2024年度（架空）.pdf');
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes />);
    expect(text()).toContain(`SHA-256（内部記録・開示しない）${sha256}`);
    expect(text()).toContain('保管先での版 ID（内部記録・開示しない）3.0');
    expect(text()).toContain('保存担当（内部記録・開示しない）総務部 担当（架空）');
    expect(text()).toContain('ファイルの記録日時（内部記録・開示しない）');
  });

  it('ファイルの記録を足す前の保存版（キーが無い）は、ファイルの記録を未入力と出す', () => {
    const legacy = {
      ...fictionalSnapshot,
      sections: {
        ...fictionalSnapshot.sections,
        evidence: (fictionalSnapshot.sections.evidence ?? []).map(item => {
          const copy: Record<string, unknown> = { ...item };
          for (const key of ['fileName', 'fileSha256', 'fileStorageVersionId', 'fileStoredBy', 'fileRecordedAt']) delete copy[key];
          return copy;
        }),
      },
    } as unknown as SsbjReportSnapshotV1;
    rendered = render(<SsbjPreviewDocument source={working(legacy)} showInternalNotes />);
    expect(text()).toContain('SHA-256（内部記録・開示しない）未入力');
    expect(text()).not.toContain('undefined');
  });
});

describe('SsbjPreviewDocument（四本柱の文章）', () => {
  it('章ごとに文章を出し、文章の無い項目は未入力。内部メモは選んだときだけ出す', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).toContain('当社では、取締役会が気候関連のリスク及び機会を監督している。');
    expect(text()).toContain('経営者の役割');
    expect(text()).toContain('当社は内部炭素価格を用いていない。');
    expect(text()).not.toContain('親会社のサステナビリティ委員会との関係は確認中（架空）。');
    expect(text()).not.toContain('まだガバナンスの文章の入力欄がありません');
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes />);
    expect(text()).toContain('親会社のサステナビリティ委員会との関係は確認中（架空）。');
  });

  it('四本柱の文章を含まない古い版は、その旨を出す', () => {
    const withoutNarratives = { ...fictionalSnapshot.sections };
    delete withoutNarratives.narratives;
    rendered = render(<SsbjPreviewDocument source={working({ ...fictionalSnapshot, sections: withoutNarratives })} showInternalNotes={false} />);
    expect(text()).toContain('この版には四本柱の文章が含まれていません');
  });
});

describe('SsbjPreviewDocument（該当性・重要性の判断）', () => {
  it('判断を記録した要求を表で出し、判断が済んでいない要求は件数で出す。内部の検討理由は選んだときだけ出す', () => {
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes={false} />);
    expect(text()).toContain('該当性・重要性・記載しない理由');
    expect(text()).toContain('適用初年度の経過措置により、スコープ 3 のカテゴリー別の内訳を開示していない。');
    expect(text()).toContain('その旨の説明が未入力');
    expect(rendered.container.querySelector('[data-testid="ssbj-preview-judgement-pending"]')?.textContent)
      .toMatch(/判断が済んでいない要求: \d+ \/ \d+ 件/);
    expect(text()).not.toContain('Scope 3 の算定体制を整備中（架空）。');
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={working()} showInternalNotes />);
    expect(text()).toContain('Scope 3 の算定体制を整備中（架空）。');
  });

  it('判断を含まない古い版は、その旨を出す（表示に未対応とは扱わない）', () => {
    const withoutJudgements = { ...fictionalSnapshot.sections };
    delete withoutJudgements.judgements;
    rendered = render(<SsbjPreviewDocument source={working({ ...fictionalSnapshot, sections: withoutJudgements })} showInternalNotes={false} />);
    expect(text()).toContain('この版には該当性・重要性の判断が含まれていません');
    expect(rendered.container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('SsbjPreviewDocument（R1 の全体確認）', () => {
  it('入力した開示内容と GHG の値をすべて出す（欠落しない）。表示に未対応の項目は無い', () => {
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes={false} />);
    expect(fictionalDisclosedTexts.filter(value => !text().includes(value))).toEqual([]);
    expect(fictionalGhgValues.map(formatDecimalForDisplay).filter(value => !text().includes(`${value} t-CO2e`))).toEqual([]);
    expect(text()).not.toContain('プレビューに表示していない項目');
  });

  it('内部記録は「内部メモも表示する」を選んだときだけ出す', () => {
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes={false} />);
    expect(fictionalInternalTexts.filter(value => text().includes(value))).toEqual([]);
    rendered.unmount();
    rendered = render(<SsbjPreviewDocument source={saved} showInternalNotes />);
    expect(fictionalInternalTexts.filter(value => !text().includes(value))).toEqual([]);
  });
});
