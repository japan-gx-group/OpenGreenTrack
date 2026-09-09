import type { ReactNode } from 'react';
import { FiscalYearProvider } from '@/contexts/FiscalYearContext.client';
import { CurrentUserProvider } from '@/contexts/CurrentUserContext.client';
import { AppRefreshProvider } from '@/contexts/AppRefreshContext.client';
import { Sidebar } from '@/components/layout/Sidebar.client';
import { AppTopBar } from '@/components/layout/AppTopBar.client';

// 認証済み（ログイン後）画面のルートグループ。URL には現れない。
// サイドバー・パンくずバーと、ログイン後にしか意味を持たない Context
// （現在ユーザー / 会計年度 / 最新データに更新）はここで 1 回だけ組み立てる。
// 未ログインのアクセスは src/proxy.ts（ミドルウェア）が /login へ振り分けるため、
// このレイアウトに到達した時点でセッションはある前提でよい。
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <CurrentUserProvider>
      <FiscalYearProvider>
        <AppRefreshProvider>
          <div className="app-root">
            <Sidebar />
            {/* パンくずバーは全画面共通のため layout で1回だけ描く。
                各画面は本文（PageHeading 以降）だけを返す。 */}
            <main className="main-content">
              <AppTopBar />
              {children}
            </main>
          </div>
        </AppRefreshProvider>
      </FiscalYearProvider>
    </CurrentUserProvider>
  );
}
