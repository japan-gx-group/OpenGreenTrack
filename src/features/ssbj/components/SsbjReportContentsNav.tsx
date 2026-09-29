// SSBJ レポートの各入力画面への入口（表示のみ）。入力画面を足した機能は SSBJ_REPORT_CONTENTS に 1 行追加する。

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';

const SSBJ_REPORT_CONTENTS: { path: string; label: string; description: string }[] = [
  {
    path: 'risks',
    label: 'リスク・機会',
    description: 'リスク・機会（種類・説明・時間軸・関連する章や項目）と、時間軸の定義を記録します。',
  },
  {
    path: 'ghg',
    label: 'GHG排出量の候補値',
    description: 'OGTのScope別・カテゴリ別の値と算定条件を確認し、レポートに採用します。',
  },
];

export const SsbjReportContentsNav = ({ reportId }: { reportId: string }) => (
  <Card>
    <h2 className="m-0 mb-3 text-base font-bold">レポートの内容</h2>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {SSBJ_REPORT_CONTENTS.map(content => (
        <li key={content.path}>
          <Link
            href={`/ssbj/${encodeURIComponent(reportId)}/${content.path}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3 hover:bg-muted"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold text-primary">{content.label}</span>
              <span className="text-xs text-text-muted">{content.description}</span>
            </span>
            <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  </Card>
);
