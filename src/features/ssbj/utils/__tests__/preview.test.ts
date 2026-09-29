import { describe, expect, it } from 'vitest';
import { fictionalSnapshot } from '../../__fixtures__/fictionalReport';
import type { SsbjReportSnapshotV1 } from '../../types';
import { formatPreviewSelection, parsePreviewSelection, unsupportedPreviewSections } from '../preview';

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
      sections: { ...fictionalSnapshot.sections, narratives: [], evidence: [] },
    } as unknown as SsbjReportSnapshotV1;
    expect(unsupportedPreviewSections(snapshot)).toEqual(['evidence', 'narratives']);
  });
});
