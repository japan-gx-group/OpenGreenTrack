import { describe, expect, it } from 'vitest';
import { fictionalSnapshot, fictionalVersion } from '../../__fixtures__/fictionalReport';
import type { SsbjReportSnapshotV1 } from '../../types';
import {
  formatPreviewSelection,
  parsePreviewSelection,
  ssbjVersionPreviewSource,
  unsupportedPreviewSections,
} from '../preview';

const VERSION_ID = '5b1f0000-0000-4000-8000-000000000004';

describe('表示する内容の選択', () => {
  it('source が保存版の ID なら保存版、それ以外（未指定・不正な値）は作業中', () => {
    expect(parsePreviewSelection(VERSION_ID)).toEqual({ kind: 'version', versionId: VERSION_ID });
    expect(parsePreviewSelection('working')).toEqual({ kind: 'working' });
    expect(parsePreviewSelection(null)).toEqual({ kind: 'working' });
    expect(parsePreviewSelection('../other')).toEqual({ kind: 'working' });
  });

  it('URL の値へ戻せる', () => {
    expect(formatPreviewSelection({ kind: 'working' })).toBe('working');
    expect(formatPreviewSelection(parsePreviewSelection(VERSION_ID))).toBe(VERSION_ID);
  });
});

describe('unsupportedPreviewSections', () => {
  it('プレビューが描けるセクションだけなら空', () => {
    expect(unsupportedPreviewSections(fictionalSnapshot)).toEqual([]);
  });

  it('描けないセクション（後から加わった機能など）の名前を返す', () => {
    const snapshot = {
      ...fictionalSnapshot,
      sections: { ...fictionalSnapshot.sections, future_b: [], future_a: [] },
    } as unknown as SsbjReportSnapshotV1;
    expect(unsupportedPreviewSections(snapshot)).toEqual(['future_a', 'future_b']);
  });
});

describe('ssbjVersionPreviewSource', () => {
  it('保存版を、版番号・保存日時・版 ID を持つプレビューの内容にする（snapshot はそのまま）', () => {
    expect(ssbjVersionPreviewSource(fictionalVersion)).toEqual({
      kind: 'version',
      versionId: fictionalVersion.id,
      versionNumber: fictionalVersion.versionNumber,
      createdAt: fictionalVersion.createdAt,
      snapshot: fictionalVersion.snapshot,
    });
  });

  it('対応していない形式・別のレポートの版は null', () => {
    const otherSchema = { ...fictionalVersion, snapshot: { ...fictionalSnapshot, schemaVersion: 2 } } as unknown as typeof fictionalVersion;
    expect(ssbjVersionPreviewSource(otherSchema)).toBeNull();
    const noSections = { ...fictionalVersion, snapshot: { ...fictionalSnapshot, sections: undefined } } as unknown as typeof fictionalVersion;
    expect(ssbjVersionPreviewSource(noSections)).toBeNull();
    expect(ssbjVersionPreviewSource({ ...fictionalVersion, reportId: '5b1f0000-0000-4000-8000-0000000000ff' })).toBeNull();
  });
});
