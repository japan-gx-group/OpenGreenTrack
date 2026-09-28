// SSBJ 画面の上部に出す位置付けの注記。R1 は社内確認用の試行版であり、
// 準拠や対外提出を保証しないことを利用者に常に見せる（docs/ssbj-spec.md §1）。

import { Info } from 'lucide-react';

export const SsbjTrialNotice = () => (
  <div
    role="note"
    className="flex items-start gap-2 rounded-md bg-info-soft px-4 py-3 text-sm text-info"
  >
    <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
    <p className="m-0">
      SSBJレポートは社内確認用の試行版です。SSBJ基準への準拠や、対外提出の完了を保証するものではありません。
    </p>
  </div>
);
