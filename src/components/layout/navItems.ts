import {
  Building2,
  FileCheck2,
  FileEdit,
  FileText,
  LayoutDashboard,
  PieChart,
  Settings2,
  type LucideIcon,
} from 'lucide-react';

/**
 * サイドバーのナビゲーション定義（デザイン正のグループ分け）。
 * パンくず（AppTopBar）も画面名をこの定義から引くため、
 * 画面を増やすときはここ1か所に足せば両方に反映される。
 */
export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'ワークスペース',
    items: [
      { path: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
      { path: '/data-input', label: 'データ入力', icon: FileEdit },
      { path: '/scope-analysis', label: 'Scope分析', icon: PieChart },
    ],
  },
  {
    label: 'マスタ',
    items: [
      { path: '/factors', label: '排出係数', icon: Settings2 },
      { path: '/locations', label: '拠点', icon: Building2 },
    ],
  },
  {
    label: '出力',
    items: [
      { path: '/reports', label: 'レポート', icon: FileText },
      { path: '/ssbj', label: 'SSBJレポート', icon: FileCheck2 },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(group => group.items);

/** パンくず末尾に出す画面名。ナビに無いパス（設定・拠点詳細など）はここで補う。 */
const EXTRA_PAGE_TITLES: { prefix: string; label: string }[] = [
  { prefix: '/settings/company', label: '企業・メンバー設定' },
  { prefix: '/settings/account', label: 'アカウント設定' },
  { prefix: '/settings', label: '設定' },
  { prefix: '/locations/', label: '拠点詳細' },
  // SSBJ の権限（/ssbj/roles）はレポート詳細（/ssbj/<id>）より先に見る。
  { prefix: '/ssbj/roles', label: 'SSBJ の権限' },
  { prefix: '/ssbj/', label: 'SSBJレポート詳細' },
];

/** パンくずの 1 段。href があれば押して戻れる（末尾の今の画面には付けない）。 */
export type Breadcrumb = { label: string; href?: string };

/**
 * SSBJ レポートの中の画面名（/ssbj/<レポートID>/<path>）。レポート詳細の「レポートの内容」
 * （features/ssbj の SSBJ_REPORT_CONTENTS）と同じ名前にする（食い違いはそちらのテストで検出する）。
 */
export const SSBJ_REPORT_PAGE_TITLES: Record<string, string> = {
  narratives: 'ガバナンス・戦略等の文章',
  risks: 'リスク・機会',
  judgements: '該当性・重要性の判断',
  ghg: 'GHG排出量の候補値',
  external: '外部で算定した排出量',
  evidence: '根拠文書・主管部署',
  preview: 'プレビュー',
  versions: '保存履歴と出力',
  history: '操作履歴',
};

/**
 * パンくず（組織名の後ろに並べる段）。SSBJ レポートの中の画面は「SSBJレポート › レポート詳細 › 画面名」にし、
 * 各段から戻れるようにする（どの画面でも「SSBJレポート詳細」だけだと、いまどの画面かが分からないため）。
 * それ以外の画面は、これまでどおり画面名 1 段（getPageTitle）。
 */
export const getBreadcrumbs = (pathname: string): Breadcrumb[] => {
  const ssbj = pathname.match(/^\/ssbj\/([^/]+)(?:\/([^/]+))?/);
  if (ssbj) {
    const [, reportId, page] = ssbj;
    const root: Breadcrumb = { label: 'SSBJレポート', href: '/ssbj' };
    if (reportId === 'roles') return [root, { label: 'SSBJ の権限' }];
    const detailHref = `/ssbj/${reportId}`;
    const pageTitle = page ? SSBJ_REPORT_PAGE_TITLES[page] : undefined;
    if (!pageTitle) return [root, { label: 'レポート詳細' }];
    return [root, { label: 'レポート詳細', href: detailHref }, { label: pageTitle }];
  }
  const title = getPageTitle(pathname);
  return title ? [{ label: title }] : [];
};

export const getPageTitle = (pathname: string): string | null => {
  const navMatch = NAV_ITEMS.find(
    item => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  // 拠点詳細（/locations/<id>）は一覧と別名にしたいので、より長い前方一致を先に見る。
  const extra = EXTRA_PAGE_TITLES.find(entry => pathname.startsWith(entry.prefix));
  if (extra) return extra.label;
  return navMatch?.label ?? null;
};
