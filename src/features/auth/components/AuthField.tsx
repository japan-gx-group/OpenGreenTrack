import type { ReactNode } from 'react';

// ペーパー地フォーム共通の入力パーツ。
// アイコン付きの角丸コンテナ（fieldShell）＋フォーカスで primary ボーダー。
// login / signup / invite の3画面で同じ様式を使い、トーンを統一する。

// 入力を包むシェル。子（input / select）は bareInputClass で枠なしにする。
export const fieldShellClass =
  'flex items-center gap-2.5 rounded-[11px] border border-border bg-bg-card px-3.5 transition-colors focus-within:border-primary';

// シェル内に置く枠なし入力。placeholder はデザイン正に合わせた淡色トークン。
export const bareInputClass =
  'w-full min-w-0 flex-1 border-none bg-transparent py-3.5 text-[14.5px] text-text-main outline-none placeholder:text-text-label';

interface AuthFieldProps {
  label: string;
  htmlFor: string;
  // 入力左のアイコン（lucide 等。currentColor で淡色ラベル色になる）
  icon?: ReactNode;
  // ラベル行の右側（例: 補助リンク）
  labelAction?: ReactNode;
  // シェル内の右端（例: パスワード表示トグル）
  adornment?: ReactNode;
  // input / select 本体
  children: ReactNode;
  // 入力下の補助テキスト
  hint?: ReactNode;
}

export const AuthField = ({
  label,
  htmlFor,
  icon,
  labelAction,
  adornment,
  children,
  hint,
}: AuthFieldProps) => (
  <div className="flex flex-col">
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-text-heading">
        {label}
      </label>
      {labelAction}
    </div>
    <div className={fieldShellClass}>
      {icon && <span className="flex shrink-0 text-text-label">{icon}</span>}
      {children}
      {adornment}
    </div>
    {hint && <span className="mt-1.5 text-xs text-text-muted">{hint}</span>}
  </div>
);
