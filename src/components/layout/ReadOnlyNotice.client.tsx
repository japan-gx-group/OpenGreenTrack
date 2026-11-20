'use client';

// 閲覧者に、画面の内容を見られるが編集はできないことを伝える案内（表示のみ）。
// ログイン後の全画面で同じ文言を出すため、(app) のレイアウトで 1 回だけ描く。
// 書き込みの操作は各画面が useReadOnly() で隠す。

import { Eye } from 'lucide-react';
import { useReadOnly } from '@/hooks/useReadOnly';

export const ReadOnlyNotice = () => {
  const readOnly = useReadOnly();
  if (!readOnly) return null;
  return (
    <div
      role="status"
      data-testid="read-only-notice"
      // 左右の余白は本文（.page-content の padding。768px 以下は 1rem）に揃える。
      className="mx-4 mt-4 md:mx-[26px] md:mt-[22px] print:hidden flex items-start gap-2 rounded-md bg-muted px-4 py-3 text-sm text-text-muted"
    >
      <Eye aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
      <p className="m-0">
        ロールが閲覧者のため、内容を見ることはできますが、編集はできません。レポートの出力と CSV エクスポートはできます。
        編集が必要な場合は、組織の管理者に連絡してください。
      </p>
    </div>
  );
};
