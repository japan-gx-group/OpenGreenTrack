'use client';

// 画面上部の細いバー（デザイン正）。左に「組織名 › 画面名」のパンくず（SSBJ レポートの中は
// 「組織名 › SSBJレポート › レポート詳細 › 画面名」。前の段は押して戻れ、狭い画面では末尾だけを出す）、
// 右に「最新データに更新」とお知らせベルだけを置く。
// 画面ごとの見出し・年度セレクタは本文側の PageHeading が持つ。

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import { getBreadcrumbs } from './navItems';
import { NotificationBell } from './NotificationBell.client';

export const AppTopBar = () => {
  const pathname = usePathname();
  const { profile } = useCurrentUser();
  const { refreshToken, requestRefresh } = useAppRefresh();
  // 押した手応えとして 1 回転させるための累積角度。
  const [spin, setSpin] = useState(0);

  const breadcrumbs = getBreadcrumbs(pathname);

  const handleRefresh = () => {
    setSpin(previous => previous + 360);
    requestRefresh();
  };

  return (
    <header className="header">
      <div className="flex items-center" style={{ gap: '9px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
        <span className="truncate">{profile?.organizationName ?? 'OpenGreenTrack'}</span>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          // 狭い画面では、途中の段を省いて末尾（今の画面）だけを出す。
          const hideOnNarrow = !isLast ? 'hidden sm:inline-flex' : 'inline-flex';
          return (
            <Fragment key={`${crumb.label}-${index}`}>
              <ChevronRight size={13} className={hideOnNarrow} style={{ color: 'var(--color-text-subtle)', flex: 'none' }} />
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className={`${hideOnNarrow} truncate hover:underline`}>{crumb.label}</Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={`${hideOnNarrow} truncate`}
                  style={{ color: 'var(--color-text-heading)', fontWeight: 600 }}
                >
                  {crumb.label}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="flex items-center" style={{ gap: '4px' }}>
        <button type="button" className="gt-iconbtn" title="最新データに更新" onClick={handleRefresh}>
          <RefreshCw
            size={17}
            strokeWidth={1.8}
            style={{ transform: `rotate(${spin}deg)`, transition: 'transform .5s cubic-bezier(.2,.7,.2,1)' }}
          />
        </button>
        <NotificationBell refreshToken={refreshToken} />
      </div>
    </header>
  );
};
