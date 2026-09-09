'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronRight,
  ChevronsUpDown,
  HelpCircle,
  LogOut,
  Menu,
  Settings,
  UserRound,
  X,
} from 'lucide-react';
import { GreenTrackMark } from '@/components/ui/GreenTrackMark';
import clsx from 'clsx';
import { createClient } from '@/lib/supabase/client';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { HelpModal } from './HelpModal.client';
import { NAV_GROUPS } from './navItems';

export const Sidebar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isLoading } = useCurrentUser();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  // ユーザーカードのメニュー（アカウント設定・ログアウト）の開閉。
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  // モバイル幅（768px以下）でのドロワー開閉状態。デスクトップでは CSS 側で
  // トグル/バックドロップごと非表示になるため、この state は表示に影響しない。
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // ページ遷移したらドロワー・メニューを閉じる。
  // effect ではなくレンダー中の比較でリセットする（React 公式の推奨パターン）。
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setIsMobileOpen(false);
    setIsUserMenuOpen(false);
  }

  const closeMobileNav = () => setIsMobileOpen(false);

  // 設定画面（/settings 配下）滞在中は下部「設定」リンクを現在地として強調する。
  // 組織カードも同じ遷移先だが、正規の入口は「設定」リンクなので強調はそちらだけに付ける。
  // 現状 /settings 直下に page.tsx は無く完全一致は到達しないが、
  // 上の NAV_GROUPS の判定（完全一致 or 配下）と同じ形に揃えている。
  const isSettingsActive = pathname === '/settings' || pathname.startsWith('/settings/');

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  // 表示名・アバターの頭文字。未取得時はプレースホルダに倒す。
  const displayName = profile?.fullName || profile?.email || 'ユーザー';
  const avatarChar = displayName.trim().charAt(0).toUpperCase() || 'U';
  const organizationName = profile?.organizationName || '組織未設定';

  return (
    <>
      {/* モバイル専用のハンバーガー/クローズボタン（デスクトップでは CSS で非表示） */}
      <button
        type="button"
        className={clsx('sidebar-toggle', { 'sidebar-toggle-open': isMobileOpen })}
        aria-label={isMobileOpen ? 'メニューを閉じる' : 'メニューを開く'}
        aria-expanded={isMobileOpen}
        aria-controls="app-sidebar"
        onClick={() => setIsMobileOpen(prev => !prev)}
      >
        {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* ドロワー展開中の背面スクリム。タップで閉じる */}
      {isMobileOpen && (
        <div className="sidebar-backdrop" aria-hidden="true" onClick={closeMobileNav} />
      )}

      <aside id="app-sidebar" className={clsx('sidebar', { 'sidebar-open': isMobileOpen })}>
        {/* 組織カード。クリックで企業設定へ */}
        <Link
          href="/settings/company"
          onClick={closeMobileNav}
          className="gt-nav"
          style={{ margin: '14px 12px 0', width: 'calc(100% - 24px)', height: 'auto', padding: '8px 10px' }}
        >
          <span
            aria-hidden
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '10px',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--color-primary-light)',
              color: 'var(--color-primary)',
            }}
          >
            <GreenTrackMark size={22} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {isLoading ? (
              <span
                className="animate-pulse"
                style={{
                  display: 'block',
                  width: '110px',
                  height: '14px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--color-border)',
                }}
              />
            ) : (
              <span
                style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: 'var(--color-text-heading)',
                  letterSpacing: '-0.01em',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {organizationName}
              </span>
            )}
            <span
              style={{
                display: 'block',
                fontSize: '11.5px',
                color: 'var(--color-text-subtle)',
                marginTop: '1px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              GreenTrack · GHG Management
            </span>
          </span>
          {/* 画面遷移なので ChevronRight。組織切替ドロップダウンを実装したら ChevronsUpDown に戻す */}
          <ChevronRight size={14} style={{ color: 'var(--color-text-subtle)', flex: 'none' }} />
        </Link>

        <nav style={{ flex: 1, padding: '16px 12px 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <div className="gt-nav-group-label">{group.label}</div>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {group.items.map(item => {
                  const isActive = pathname === item.path || pathname.startsWith(`${item.path}/`);
                  return (
                    <li key={item.path}>
                      <Link
                        href={item.path}
                        onClick={closeMobileNav}
                        aria-current={isActive ? 'page' : undefined}
                        className={clsx('gt-nav', { 'gt-nav-active': isActive })}
                      >
                        <item.icon
                          size={17}
                          strokeWidth={1.85}
                          style={{ color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)', flex: 'none' }}
                        />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div
          style={{
            padding: '12px',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <button type="button" className="gt-nav gt-nav-sm" onClick={() => setIsHelpOpen(true)}>
            <HelpCircle size={16} style={{ color: 'var(--color-text-subtle)', flex: 'none' }} />
            <span>ヘルプ</span>
          </button>
          <Link
            href="/settings/company"
            onClick={closeMobileNav}
            aria-current={isSettingsActive ? 'page' : undefined}
            className={clsx('gt-nav gt-nav-sm', { 'gt-nav-active': isSettingsActive })}
          >
            <Settings
              size={16}
              style={{ color: isSettingsActive ? 'var(--color-primary)' : 'var(--color-text-subtle)', flex: 'none' }}
            />
            <span>設定</span>
          </Link>

          {/* ユーザーカード。アカウント設定とログアウトをまとめる */}
          <div style={{ position: 'relative', marginTop: '8px' }}>
            {isUserMenuOpen && (
              <>
                {/* 外側クリックで閉じるための透明レイヤ */}
                <div
                  className="fixed inset-0"
                  style={{ zIndex: 39 }}
                  aria-hidden="true"
                  onClick={() => setIsUserMenuOpen(false)}
                />
                <div className="gt-menu" style={{ top: 'auto', bottom: 'calc(100% + 6px)', left: 0, right: 0 }}>
                  <Link
                    href="/settings/account"
                    className="gt-menuitem"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      closeMobileNav();
                    }}
                  >
                    <UserRound size={14} style={{ color: 'var(--color-text-muted)', flex: 'none' }} />
                    <span className="flex-1">アカウント設定</span>
                  </Link>
                  <button type="button" className="gt-menuitem" onClick={handleSignOut}>
                    <LogOut size={14} style={{ color: 'var(--color-text-muted)', flex: 'none' }} />
                    <span className="flex-1">ログアウト</span>
                  </button>
                </div>
              </>
            )}
            <button
              type="button"
              className="flex w-full items-center"
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              onClick={() => setIsUserMenuOpen(prev => !prev)}
              style={{
                gap: '10px',
                padding: '8px 10px',
                backgroundColor: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <span
                className="rounded-full"
                style={{
                  width: '32px',
                  height: '32px',
                  flex: 'none',
                  backgroundColor: 'var(--color-primary-light)',
                  color: 'var(--color-primary-dark)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '12.5px',
                  fontWeight: 600,
                }}
              >
                {avatarChar}
              </span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--color-text-heading)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {displayName}
                </span>
                <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-subtle)' }}>メンバー</span>
              </span>
              <ChevronsUpDown size={14} style={{ color: 'var(--color-text-subtle)', flex: 'none' }} />
            </button>
          </div>
        </div>

        {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}
      </aside>
    </>
  );
};
