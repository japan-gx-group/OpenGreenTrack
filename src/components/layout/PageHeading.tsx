// 本文先頭の画面見出し（大見出し＋説明＋右肩の操作群）。
// 上部バー（AppTopBar）はパンくずとアイコン操作だけを持ち、
// 画面固有の見出し・年度セレクタ・主要導線はこちらに置く（デザイン正）。

import type { ReactNode } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { FiscalYearMenu } from './FiscalYearMenu.client';

type PageHeadingProps = {
  title: string;
  /** 見出しのすぐ横に添える小さな表示（例: 入力画面の「未保存 n」のバッジ） */
  titleAside?: ReactNode;
  /** 見出し直下の1行説明 */
  description?: string;
  /** 年度セレクタの左に置く画面固有の操作（例: ダッシュボードの拠点絞り込み） */
  actions?: ReactNode;
  /** 年度セレクタを表示するか。年度に依存しない画面では false。既定は true */
  showFiscalYear?: boolean;
  /** 右端の主要ボタン。既定は「レポートを作成」。null を渡すと出さない */
  primaryAction?: ReactNode | null;
};

const CreateReportButton = () => (
  <Link href="/reports" className="gt-btn-primary">
    <FileText size={15} strokeWidth={1.9} />
    レポートを作成
  </Link>
);

export const PageHeading = ({
  title,
  titleAside,
  description,
  actions,
  showFiscalYear = true,
  primaryAction,
}: PageHeadingProps) => {
  const resolvedPrimaryAction =
    primaryAction === undefined ? <CreateReportButton /> : primaryAction;

  return (
    <div className="gt-page-heading">
      <div style={{ minWidth: 0 }}>
        {titleAside ? (
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="gt-page-title">{title}</h1>
            {titleAside}
          </div>
        ) : (
          <h1 className="gt-page-title">{title}</h1>
        )}
        {description && <p className="gt-page-sub">{description}</p>}
      </div>
      <div className="gt-page-heading-actions">
        {actions}
        {showFiscalYear && <FiscalYearMenu />}
        {resolvedPrimaryAction}
      </div>
    </div>
  );
};
