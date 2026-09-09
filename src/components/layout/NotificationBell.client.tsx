'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, CheckCircle2, Info } from 'lucide-react';
import {
  countUnread,
  formatRelativeTime,
  getNotifications,
  getReadMarker,
  setReadMarker,
  type AppNotification,
  type AppNotificationLevel,
} from '@/features/notifications/services/notificationService';

const LEVEL_ICON: Record<AppNotificationLevel, typeof Info> = {
  info: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

const LEVEL_COLOR: Record<AppNotificationLevel, string> = {
  info: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
};

export const NotificationBell = ({ refreshToken }: { refreshToken: number }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [readMarker, setReadMarkerState] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    getNotifications()
      .then(items => {
        if (!isMounted) return;
        setNotifications(items);
        // localStorage は SSR では読めないため、取得完了後（クライアント）に既読基準を取り込む。
        // お知らせが0件のうちは未読数も0なので、この時点まで読まなくても表示は変わらない。
        setReadMarkerState(getReadMarker());
      })
      .catch(() => {
        // お知らせが取れなくても画面本体には影響しないため、空のまま黙って続行する。
      });
    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  const unreadCount = countUnread(notifications, readMarker);

  const handleToggle = () => {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    // 開いた時点を既読の基準にする（個別の既読管理は持たない）。
    if (nextOpen && notifications.length > 0) {
      const latest = notifications[0].occurredAt;
      setReadMarker(latest);
      setReadMarkerState(latest);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      {isOpen && (
        <div
          className="fixed inset-0"
          style={{ zIndex: 39 }}
          aria-hidden="true"
          onClick={() => setIsOpen(false)}
        />
      )}
      <button
        type="button"
        className="gt-iconbtn"
        title="お知らせ"
        aria-label={unreadCount > 0 ? `お知らせ（未読 ${unreadCount} 件）` : 'お知らせ'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={handleToggle}
        style={{ position: 'relative' }}
      >
        <Bell size={17} strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span
            className="rounded-full"
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: '7px',
              right: '7px',
              width: '7px',
              height: '7px',
              backgroundColor: 'var(--color-danger)',
              border: '1.5px solid var(--color-bg-main)',
            }}
          />
        )}
      </button>

      {isOpen && (
        <div className="gt-menu" style={{ right: 0, width: '340px', padding: '5px' }}>
          <div className="gt-menu-label">お知らせ</div>
          {notifications.length === 0 ? (
            <p style={{ padding: '18px 12px', fontSize: '12.5px', color: 'var(--color-text-subtle)', textAlign: 'center' }}>
              新しいお知らせはありません。
            </p>
          ) : (
            <ul>
              {notifications.map(notification => {
                const Icon = LEVEL_ICON[notification.level];
                const body = (
                  <>
                    <Icon
                      size={15}
                      style={{ color: LEVEL_COLOR[notification.level], flex: 'none', marginTop: '2px' }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--color-text-heading)' }}>
                        {notification.title}
                      </span>
                      <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                        {notification.description}
                      </span>
                      <span style={{ display: 'block', fontSize: '11px', color: 'var(--color-text-subtle)', marginTop: '3px' }}>
                        {formatRelativeTime(notification.occurredAt)}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={notification.id}>
                    {notification.href ? (
                      <Link
                        href={notification.href}
                        className="gt-menuitem"
                        style={{ alignItems: 'flex-start', height: 'auto', padding: '9px 10px' }}
                        onClick={() => setIsOpen(false)}
                      >
                        {body}
                      </Link>
                    ) : (
                      <div
                        className="gt-menuitem"
                        style={{ alignItems: 'flex-start', height: 'auto', padding: '9px 10px', cursor: 'default' }}
                      >
                        {body}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
