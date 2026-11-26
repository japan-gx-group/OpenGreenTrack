// 進み具合の細いバー（表示のみ）。数は隣に文字で出すので、バーは読み上げない。

import { cn } from 'cn';

export const SsbjProgressBar = ({ ratio, className }: { ratio: number; className?: string }) => {
  const percent = Math.round(Math.min(Math.max(ratio, 0), 1) * 100);
  return (
    <span aria-hidden="true" className={cn('block h-1 overflow-hidden rounded-full bg-primary-light', className)}>
      <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </span>
  );
};
