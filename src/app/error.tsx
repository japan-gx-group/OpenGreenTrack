// 画面単位のエラーバウンダリ。ルートレイアウトは生きているため globals.css は読み込み済み。
// (app) / (auth) 両グループの配下で起きたエラーを受け、グループのレイアウトごと
// 差し替えるためシェル無しで描かれる。ルートレイアウトごと壊れた場合は global-error.tsx が受け持つ。
'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { clientLogger } from '@/lib/logging/clientLogger';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLogger.error('未処理のエラーが発生しました', {
      errorMessage: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold text-text-heading">
        エラーが発生しました
      </h2>
      <p className="text-text-muted">
        予期しないエラーが発生しました。もう一度お試しください。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-primary px-6 py-2 text-white hover:bg-primary-dark transition-colors"
        >
          再試行
        </button>
        <Link
          href="/dashboard"
          className="rounded-lg border border-border bg-bg-card px-6 py-2 text-text-main hover:bg-bg-subtle transition-colors"
        >
          ダッシュボードへ戻る
        </Link>
      </div>
    </div>
  );
}
