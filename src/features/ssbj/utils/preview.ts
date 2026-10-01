// SSBJ レポートのプレビュー（T12）の純粋関数: 表示する内容の選び方と、表示に対応していないセクションの検出。

import type { SsbjReportSnapshotV1 } from '../types';

/** プレビューで何を表示するか。作業中の内容か、保存版 1 件か。 */
export type SsbjPreviewSelection = { kind: 'working' } | { kind: 'version'; versionId: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL の source パラメータ（"working" か保存版の ID）を選択に変換する。不正な値は作業中にする。 */
export const parsePreviewSelection = (value: string | null): SsbjPreviewSelection =>
  value && UUID_PATTERN.test(value) ? { kind: 'version', versionId: value } : { kind: 'working' };

/** 選択を URL の source パラメータに変換する（parsePreviewSelection の逆）。 */
export const formatPreviewSelection = (selection: SsbjPreviewSelection): string =>
  selection.kind === 'working' ? 'working' : selection.versionId;

// プレビューが描けるセクション。ここに無いセクションは、黙って落とさず「表示に未対応」として名前を出す。
const PREVIEW_SECTIONS = new Set(['risks_opportunities', 'time_horizons', 'ghg', 'evidence', 'narratives', 'judgements']);

/** 保存版に含まれるが、プレビューがまだ描けないセクションのキー。 */
export const unsupportedPreviewSections = (snapshot: SsbjReportSnapshotV1): string[] =>
  Object.keys(snapshot.sections ?? {}).filter(key => !PREVIEW_SECTIONS.has(key)).sort();
