// レポートの中の画面（/ssbj/[reportId]/**）のうち、今どの画面にいるか。レイアウト（app/(app)/ssbj/[reportId]/layout.tsx）の
// 下の選択中のセグメント（next/navigation の useSelectedLayoutSegments）から決める。

/** 今いる画面。current は /ssbj/[reportId]/ の下の 1 段目のパス（詳細画面は ''）。isPrint は印刷ビュー（画面の上の部品を出さない）。 */
export type SsbjReportRoute = { current: string; isPrint: boolean };

/** ルートグループ（`(…)`）とページ自身（`__PAGE__` など `__` で始まるもの）は画面の名前ではないので除く。 */
export const ssbjReportRoute = (segments: readonly string[]): SsbjReportRoute => {
  const names = segments.filter(segment => !segment.startsWith('(') && !segment.startsWith('__'));
  return { current: names[0] ?? '', isPrint: names[0] === 'preview' && names[1] === 'print' };
};
