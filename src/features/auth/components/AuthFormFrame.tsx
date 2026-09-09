import type { ReactNode } from 'react';
import clsx from 'clsx';

// 認証画面のフォーム本体の幅を決める枠。2カラムシェル（AuthLayout）は
// src/app/(auth)/layout.tsx が描くため、各フォームはこの枠で包んだ中身だけを返す。
// 幅はフォームごとに違う（ログイン/招待は狭め、初期セットアップのウィザードは広め）ので、
// レイアウト側ではなくフォーム側が指定する。

interface AuthFormFrameProps {
  children: ReactNode;
  // フォーム面の最大幅（Tailwind の max-w-* クラス）。
  maxWidthClass?: string;
}

export const AuthFormFrame = ({ children, maxWidthClass = 'max-w-[404px]' }: AuthFormFrameProps) => (
  <div className={clsx('w-full', maxWidthClass)}>{children}</div>
);
