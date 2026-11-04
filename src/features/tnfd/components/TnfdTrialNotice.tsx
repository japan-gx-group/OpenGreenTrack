// TNFD 画面の上部に出す位置付けの注記。R1 は社内確認用の試行版であり、
// 準拠や対外提出を保証しないことを利用者に常に見せる（docs/tnfd-spec.md §1）。

import { Info } from 'lucide-react';

export const TnfdTrialNotice = () => (
  <div
    role="note"
    className="flex items-start gap-2 rounded-md bg-info-soft px-4 py-3 text-sm text-info"
  >
    <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
    <p className="m-0">
      TNFDレポートは社内確認用の試行版です。TNFD提言への準拠や、対外提出の完了を保証するものではありません。
    </p>
  </div>
);
