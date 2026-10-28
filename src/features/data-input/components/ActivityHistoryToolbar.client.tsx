'use client';

// 入力履歴カードの見出しと「帳票の一覧」「最新の状態に更新」ボタン。

import { Paperclip, RefreshCw } from 'lucide-react';

interface ActivityHistoryToolbarProps {
  /** 登録済み件数（絞り込み前） */
  totalCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** 組織の帳票の一覧を開く。指定したときだけボタンを出す */
  onOpenEvidenceList?: () => void;
}

export const ActivityHistoryToolbar = ({
  totalCount,
  isRefreshing,
  onRefresh,
  onOpenEvidenceList,
}: ActivityHistoryToolbarProps) => (
  <div className="gt-card-head">
    <div>
      <h2 className="gt-card-title">入力履歴</h2>
      <p className="gt-card-sub">
        登録済み {totalCount} 件・行をクリックすると編集できます
      </p>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {onOpenEvidenceList && (
        <button type="button" className="gt-btn" onClick={onOpenEvidenceList}>
          <Paperclip size={15} /> 帳票の一覧
        </button>
      )}
      <button
        type="button"
        className="gt-btn"
        onClick={onRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} /> 最新の状態に更新
      </button>
    </div>
  </div>
);
