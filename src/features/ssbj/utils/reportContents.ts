// SSBJ レポートの中の画面の一覧。詳細画面の「レポートの内容」（SsbjReportContentsNav）と、画面の上のタブ（SsbjReportTabs）が使う。
// 入力画面を足した機能は SSBJ_REPORT_CONTENTS に 1 行追加する。

export type SsbjReportContent = {
  /** /ssbj/[reportId]/ の下のパス。 */
  path: string;
  label: string;
  /** タブに出す短い名前。 */
  tabLabel: string;
  description: string;
  /** 閲覧者（作業中の内容を見られない）にも出すか。 */
  viewer?: boolean;
};

// viewer = 閲覧者（作業中の内容を見られない）にも出すか。承認した保存版を見る画面だけ。
// label は、パンくずの画面名（components/layout/navItems.ts の SSBJ_REPORT_PAGE_TITLES）と同じ名前にする（テストで照合する）。
export const SSBJ_REPORT_CONTENTS: readonly SsbjReportContent[] = [
  {
    path: 'narratives',
    label: 'ガバナンス・戦略等の文章',
    tabLabel: '文章',
    description: 'ガバナンス・戦略・リスク管理・指標及び目標の文章を、要求項目と記載ガイドを見ながら書きます。',
  },
  {
    path: 'risks',
    label: 'リスク・機会',
    tabLabel: 'リスク・機会',
    description: 'リスク・機会（種類・説明・時間軸・関連する章や項目）と、時間軸の定義を記録します。',
  },
  {
    path: 'judgements',
    label: '該当性・重要性の判断',
    tabLabel: '判断',
    description: '要求ごとに、該当するか・重要性があるか・記載しない場合の理由（経過措置など）を記録します。',
  },
  {
    path: 'ghg',
    label: 'GHG排出量の候補値',
    tabLabel: 'GHG',
    description: 'OGTのScope別・カテゴリ別の値と算定条件を確認し、レポートに採用します。',
  },
  {
    path: 'external',
    label: '外部で算定した排出量',
    tabLabel: '外部算定値',
    description: 'OGT で算定できない排出量（CO2 以外のガスなど）を、出典・根拠文書・確認者を付けて採用します。',
  },
  {
    path: 'evidence',
    label: '根拠文書・主管部署',
    tabLabel: '根拠',
    description: '項目ごとの資料名、参照位置、主管部署を記録します。',
  },
  {
    path: 'preview',
    viewer: true,
    label: 'プレビュー',
    tabLabel: 'プレビュー',
    description: '作業中の内容または保存版を、レポートの形で確認し、印刷・PDFとして保存します。',
  },
  {
    path: 'versions',
    viewer: true,
    label: '保存履歴と出力',
    tabLabel: '保存履歴',
    description: '保存版の内容の確認、過去の版への復元、CSV・Excel の出力を行います。',
  },
  {
    path: 'history',
    label: '操作履歴',
    tabLabel: '操作履歴',
    description: '誰がいつ何をしたか（作成・更新・承認・出力など）を確認し、CSV・Excel で出力します。',
  },
];

/** 画面の上のタブの並び。先頭は詳細画面（path = ''）。workingAccess = false（閲覧者）のときは閲覧できる画面だけ。 */
export const ssbjReportTabs = (workingAccess: boolean): { path: string; label: string }[] => [
  { path: '', label: '概要' },
  ...SSBJ_REPORT_CONTENTS
    .filter(content => workingAccess || content.viewer)
    .map(content => ({ path: content.path, label: content.tabLabel })),
];

/** レポートの中の画面の URL（path = '' は詳細画面）。 */
export const ssbjReportPath = (reportId: string, path: string): string =>
  `/ssbj/${encodeURIComponent(reportId)}${path ? `/${path}` : ''}`;
