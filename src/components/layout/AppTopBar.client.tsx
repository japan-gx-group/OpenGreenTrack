'use client';

// 画面上部の細いバー（デザイン正）。左に「組織名 › 画面名」のパンくず、
// 右に「最新データに更新」とお知らせベルだけを置く。
// 画面ごとの見出し・年度セレクタは本文側の PageHeading が持つ。

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import { getPageTitle } from './navItems';
import { NotificationBell } from './NotificationBell.client';

export const AppTopBar = () => {
  const pathname = usePathname();
  const { profile } = useCurrentUser();
  const { refreshToken, requestRefresh } = useAppRefresh();
  // 押した手応えとして 1 回転させるための累積角度。
  const [spin, setSpin] = useState(0);

  const pageTitle = getPageTitle(pathname);

  const handleRefresh = () => {
    setSpin(previous => previous + 360);
    requestRefresh();
  };

  return (
    <header className="header">
      <div className="flex items-center" style={{ gap: '9px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
        <span className="truncate">{profile?.organizationName ?? 'OpenGreenTrack'}</span>
        {pageTitle && (
          <>
            <ChevronRight size={13} style={{ color: 'var(--color-text-subtle)', flex: 'none' }} />
            <span style={{ color: 'var(--color-text-heading)', fontWeight: 600 }}>{pageTitle}</span>
          </>
        )}
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
