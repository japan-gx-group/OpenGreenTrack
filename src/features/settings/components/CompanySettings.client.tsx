'use client';

import React, { useRef, useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { CompanyInfo } from './CompanyInfo.client';
import { MemberList } from './MemberList.client';
import { FiscalYearList } from './FiscalYearList.client';
import { CheckCircle, AlertCircle } from 'lucide-react';

export const CompanySettings = () => {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [fiscalYearListRefreshKey, setFiscalYearListRefreshKey] = useState(0);

  // 前のトーストの消去タイマーが後から表示したトーストを早期に消さないよう、表示のたびにキャンセルする
  // （AccountSettings / Locations と同じ方針）。
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      {/* 年度別のデータを扱わない画面のため、ヘッダーの年度セレクタは出さない。
          この画面の FiscalYearList は年度マスタ自体を編集する場所で、
          追加直後にセレクタだけ古い選択肢が残る紛らわしさも避ける。 */}
      <div className="page-content gt-scroll max-w-[900px] mx-auto pb-12">
        <PageHeading
          title="企業・メンバー設定"
          description="組織情報・算定年度・メンバーの管理"
          showFiscalYear={false}
          primaryAction={null}
        />
        <div className="flex flex-col" style={{ gap: '14px' }}>
        <CompanyInfo
          showToast={showToast}
          onSaved={() => setFiscalYearListRefreshKey((key) => key + 1)}
        />
        {/* 会計年度は自組織マスタ */}
        <FiscalYearList showToast={showToast} refreshKey={fiscalYearListRefreshKey} />
        <MemberList showToast={showToast} />
        </div>
      </div>

      {toast && (
        <div
          className={`fixed top-5 right-5 z-[9999] flex items-center gap-3 px-6 py-4 rounded-md border shadow-md animate-toast-in ${
            toast.type === 'success'
              ? 'bg-primary/5 border-primary/30 text-primary'
              : 'bg-danger/5 border-danger/30 text-danger'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="text-sm font-semibold text-text-main">{toast.message}</span>
        </div>
      )}
    </>
  );
};
