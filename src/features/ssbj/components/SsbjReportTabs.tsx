// レポートの中の画面を移るタブ（表示のみ）。どの画面からも 1 回で移れるようにする。
// 入力の画面のタブには、進み具合の数（「14/20」など）と細いバーを添える（数え方は utils/reportProgress.ts）。
// 今いる画面を強調し、aria-current="page" を付ける。狭い幅では横にスクロールする。

import Link from 'next/link';
import { cn } from 'cn';
import { ssbjReportPath, ssbjReportTabs } from '../utils/reportContents';
import { ssbjContentProgress, type SsbjReportProgress } from '../utils/reportProgress';
import { SsbjProgressBar } from './SsbjProgressBar';

interface SsbjReportTabsProps {
  reportId: string;
  /** 今いる画面のパス（詳細画面は ''）。 */
  current: string;
  /** false（閲覧者）のときは、閲覧できる画面のタブだけを出す。 */
  workingAccess: boolean;
  /** 進み具合（読み込み中・閲覧者は null。数を出さない）。 */
  progress: SsbjReportProgress | null;
}

export const SsbjReportTabs = ({ reportId, current, workingAccess, progress }: SsbjReportTabsProps) => (
  <nav aria-label="レポートの中の画面" data-testid="ssbj-report-tabs" className="overflow-x-auto">
    <ul className="m-0 flex min-w-max list-none gap-1 border-b border-border p-0">
      {ssbjReportTabs(workingAccess).map(tab => {
        const isCurrent = tab.path === current;
        const count = progress ? ssbjContentProgress(tab.path, progress) : null;
        return (
          <li key={tab.path} className="flex">
            <Link
              href={ssbjReportPath(reportId, tab.path)}
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                '-mb-px flex flex-col justify-center gap-1 border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                isCurrent
                  ? 'border-primary font-bold text-primary'
                  : 'border-transparent font-semibold text-text-muted hover:text-foreground',
              )}
            >
              <span className="flex items-center gap-1.5">
                {tab.label}
                {count && <span className="text-xs font-normal tabular-nums text-text-muted">{count.text}</span>}
              </span>
              {count && count.ratio !== null && <SsbjProgressBar ratio={count.ratio} />}
            </Link>
          </li>
        );
      })}
    </ul>
  </nav>
);
