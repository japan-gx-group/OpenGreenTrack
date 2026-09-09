// ルートレイアウト自体が壊れた場合のエラーバウンダリ。
// global-error.tsx は app/layout.tsx を丸ごと置き換えるため、layout.tsx で import している
// globals.css は読み込まれない。Tailwind のトークン（bg-bg-main 等）を使うには
// ここでも明示的に import する必要がある。
'use client';

import { useEffect } from 'react';
import { clientLogger } from '@/lib/logging/clientLogger';
import '@/styles/globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLogger.error('ルートレベルのシステムエラーが発生しました', {
      errorMessage: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="ja">
      <body className="flex min-h-screen items-center justify-center bg-bg-main text-text-main">
        <div className="text-center space-y-4 p-8">
          <h2 className="text-xl font-semibold">
            システムエラーが発生しました
          </h2>
          <p className="text-text-muted">
            ページを再読み込みしてください。
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-primary px-6 py-2 text-white hover:bg-primary-dark transition-colors"
            >
              再読み込み
            </button>
            {/* ルートレイアウトごと壊れておりルーターも信頼できないため、
                next/link ではなく <a> でフルリロードしてダッシュボードへ戻す。
                (app)/[...not-found] のキャッチオールにより全 URL がページ扱いになり
                no-html-link-for-pages が反応するが、ここは意図した <a> なので除外する */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/dashboard"
              className="rounded-lg border border-border bg-bg-card px-6 py-2 text-text-main hover:bg-bg-subtle transition-colors"
            >
              ダッシュボードへ戻る
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
