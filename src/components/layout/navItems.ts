import {
  Building2,
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
    items: [{ path: '/reports', label: 'レポート', icon: FileText }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(group => group.items);

/** パンくず末尾に出す画面名。ナビに無いパス（設定・拠点詳細など）はここで補う。 */
const EXTRA_PAGE_TITLES: { prefix: string; label: string }[] = [
  { prefix: '/settings/company', label: '企業・メンバー設定' },
  { prefix: '/settings/account', label: 'アカウント設定' },
  { prefix: '/settings', label: '設定' },
  { prefix: '/locations/', label: '拠点詳細' },
];

export const getPageTitle = (pathname: string): string | null => {
  const navMatch = NAV_ITEMS.find(
    item => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  // 拠点詳細（/locations/<id>）は一覧と別名にしたいので、より長い前方一致を先に見る。
  const extra = EXTRA_PAGE_TITLES.find(entry => pathname.startsWith(entry.prefix));
  if (extra) return extra.label;
  return navMatch?.label ?? null;
};
