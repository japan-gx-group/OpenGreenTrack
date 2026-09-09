import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Instrument_Sans } from 'next/font/google';
import '@/styles/globals.css';

// ルートレイアウトは <html>/<body>・フォント・グローバルCSSだけを持つ。
// 画面の骨格（サイドバー・パンくずバー・各 Context）は認証済み画面のルートグループ
// src/app/(app)/layout.tsx が、認証画面の2カラムシェルは src/app/(auth)/layout.tsx が持つ。
// ここに Provider やシェルを戻さないこと（ログイン画面にまでサイドバー用の Context が
// 乗り、パス判定で出し分ける二重管理に戻ってしまう）。

// UI全体を Instrument Sans（本文・見出し・数値すべて）で統一する。
// next/font がビルド時にセルフホストし、CSS変数へ font-family を注入する。
// 外部 <link>/@import は使わない（AGENTS.md: 新規ライブラリ・外部依存の追加禁止）。
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GreenTrack',
  description: '企業向けGHG（温室効果ガス）排出量算定・可視化ツール',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className={instrumentSans.variable}>
      <body>{children}</body>
    </html>
  );
}
