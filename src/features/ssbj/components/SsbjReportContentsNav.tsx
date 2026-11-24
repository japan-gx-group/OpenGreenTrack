// SSBJ レポートの各入力画面への入口（表示のみ）。入力画面を足した機能は SSBJ_REPORT_CONTENTS に 1 行追加する。

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { getVisibleSsbjReportContents, ssbjReportPath } from '../utils/reportContents';

/** workingAccess = false（閲覧者）のときは、承認した保存版を見る画面だけを出す。 */
export const SsbjReportContentsNav = ({ reportId, workingAccess = true }: { reportId: string; workingAccess?: boolean }) => (
  <Card>
    <h2 className="m-0 mb-3 text-base font-bold">レポートの内容</h2>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {getVisibleSsbjReportContents(workingAccess).map(content => (
        <li key={content.path}>
          <Link
            href={ssbjReportPath(reportId, content.path)}
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
