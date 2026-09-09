import { notFound } from 'next/navigation';

// どのルートにも一致しない URL を (app) グループへ引き込むためのキャッチオール。
// Next.js の 404 は既定ではルート直下の not-found.tsx をシェル無しで描くため、
// ここで notFound() を投げて (app)/not-found.tsx をサイドバー付きで描かせる。
// 未ログインのアクセスは先に src/proxy.ts が /login へ振り分けるので、ここに来るのはログイン済みだけ。
export default function CatchAllNotFound() {
  notFound();
}
