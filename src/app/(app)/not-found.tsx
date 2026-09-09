// 存在しないURLにアクセスした場合の404ページ。隣の [...not-found]/page.tsx が
// 一致しない URL をこのグループへ引き込んで notFound() を投げるため、
// (app)/layout.tsx のサイドバー・パンくずバー付きで描かれる（通常ページと同じ見た目）。
// 静的な表示のみなので Server Component のままにする（'use client' 不要）。
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm font-semibold text-text-muted">404</p>
      <h2 className="text-xl font-semibold text-text-heading">
        ページが見つかりません
      </h2>
      <p className="text-text-muted">
        お探しのページは存在しないか、URLが変更された可能性があります。
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-primary px-6 py-2 text-white hover:bg-primary-dark transition-colors"
      >
        ダッシュボードへ戻る
      </Link>
    </div>
  );
}
