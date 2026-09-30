// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';
import type { SsbjPreviewSource } from '../../services/previewService';
import type { SsbjReportSnapshotV1 } from '../../types';
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
    expect(text()).toContain('ロケーション基準の値は含みません');
    expect(text()).toContain('サプライヤー別排出量は参考値であり、Scope 3 の合計には含めていません');
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
      sections: { ...fictionalSnapshot.sections, judgements: [] },
    } as unknown as SsbjReportSnapshotV1;
    rendered = render(<SsbjPreviewDocument source={working(snapshot)} showInternalNotes={false} />);
    const alert = rendered.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('judgements');
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
});
