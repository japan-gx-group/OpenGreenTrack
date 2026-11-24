export type SsbjReportContent = {
  path: string;
  label: string;
  description: string;
  // 閲覧者（作業中の内容を見られない）にも出すか。承認した保存版を見る画面だけ。
  viewer?: boolean;
};

export const SSBJ_REPORT_CONTENTS: readonly SsbjReportContent[] = [
  {
    path: 'narratives',
    label: '四本柱の文章',
    description: 'ガバナンス・戦略・リスク管理・指標及び目標の文章を、要求項目と記載ガイドを見ながら書きます。',
  },
  {
    path: 'risks',
    label: 'リスク・機会',
    description: 'リスク・機会（種類・説明・時間軸・関連する章や項目）と、時間軸の定義を記録します。',
  },
  {
    path: 'judgements',
    label: '該当性・重要性の判断',
    description: '要求ごとに、該当するか・重要性があるか・記載しない場合の理由（経過措置など）を記録します。',
  },
  {
    path: 'ghg',
    label: 'GHG排出量の候補値',
    description: 'OGTのScope別・カテゴリ別の値と算定条件を確認し、レポートに採用します。',
  },
  {
    path: 'external',
    label: '外部で算定した排出量',
    description: 'OGT で算定できない排出量（CO2 以外のガスなど）を、出典・根拠文書・確認者を付けて採用します。',
  },
  {
    path: 'evidence',
    label: '根拠文書・主管部署',
    description: '項目ごとの資料名、参照位置、主管部署を記録します。',
  },
  {
    path: 'preview',
    viewer: true,
    label: 'プレビュー',
    description: '作業中の内容または保存版を、レポートの形で確認し、印刷・PDFとして保存します。',
  },
  {
    path: 'versions',
    viewer: true,
    label: '保存履歴と出力',
    description: '保存版の内容の確認、過去の版への復元、CSV・Excel の出力を行います。',
  },
  {
    path: 'history',
    label: '操作履歴',
    description: '誰がいつ何をしたか（作成・更新・承認・出力など）を確認し、CSV・Excel で出力します。',
  },
];

export const getVisibleSsbjReportContents = (workingAccess: boolean) =>
  SSBJ_REPORT_CONTENTS.filter(content => workingAccess || content.viewer);

/** レポートの中の画面の URL（path = '' は詳細画面）。 */
export const ssbjReportPath = (reportId: string, path: string): string =>
  `/ssbj/${encodeURIComponent(reportId)}${path ? `/${path}` : ''}`;

export const getSsbjReportBreadcrumb = (pathname: string) => {
  const match = /^\/ssbj\/([^/]+)(?:\/([^/]+)(\/print)?)?\/?$/.exec(pathname);
  if (!match) return null;

  const [, segment, tabPath, print] = match;
  if (print && tabPath !== 'preview') return null;

  const tab = SSBJ_REPORT_CONTENTS.find(content => content.path === tabPath);
  if (tabPath && !tab) return null;

  try {
    const reportId = decodeURIComponent(segment);
    if (reportId === 'roles' || reportId === '.' || reportId === '..' || reportId.includes('/')) return null;
    return { reportId, tab, isPrint: Boolean(print) };
  } catch {
    return null;
  }
};
