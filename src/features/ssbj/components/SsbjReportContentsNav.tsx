// SSBJ レポートの各入力画面への入口（表示のみ）。入力画面を足した機能は SSBJ_REPORT_CONTENTS に 1 行追加する。
// 画面の一覧は utils/reportContents.ts（画面の上のタブと共通）。進み具合を渡したときは、全体の進み具合と
// 「次にやること」（押すと該当の画面へ移る）を出す。数え方は utils/reportProgress.ts。
// 画面の上にタブがあるとき（withTabs）は、各画面の説明の一覧がタブと重なるので、畳んで出す。

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SSBJ_REPORT_CONTENTS, ssbjReportPath } from '../utils/reportContents';
import { ssbjNextSteps, ssbjOverallProgress, type SsbjReportProgress } from '../utils/reportProgress';
import { SsbjProgressBar } from './SsbjProgressBar';

interface SsbjReportContentsNavProps {
  reportId: string;
  workingAccess?: boolean;
  /** 作業中の内容から数えた進み具合（閲覧者・Provider の外では渡さない）。 */
  progress?: { progress: SsbjReportProgress | null; errorMessage: string } | null;
  /** 画面の上にタブがあるとき true（各画面の説明の一覧を畳む）。 */
  withTabs?: boolean;
}

const ContentsList = ({ reportId, workingAccess }: { reportId: string; workingAccess: boolean }) => (
  <ul className="m-0 flex list-none flex-col gap-2 p-0">
    {SSBJ_REPORT_CONTENTS.filter(content => workingAccess || content.viewer).map(content => (
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
);

const ProgressSummary = ({ reportId, progress }: { reportId: string; progress: SsbjReportProgress }) => {
  const overall = ssbjOverallProgress(progress);
  const steps = ssbjNextSteps(progress);
  const rows = [
    { key: 'narratives', label: '文章', done: progress.narratives.done, total: progress.narratives.total },
    { key: 'judgements', label: '判断', done: progress.judgements.decided, total: progress.judgements.total },
    { key: 'evidence', label: '根拠', done: progress.evidence.withEvidence, total: progress.evidence.total },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="ssbj-report-progress">
      <div className="flex flex-col gap-2">
        <p className="m-0 flex items-baseline justify-between gap-2 text-sm font-semibold">
          全体の進み具合
          <span className="text-lg font-bold tabular-nums text-primary">{Math.round(overall.ratio * 100)} %</span>
        </p>
        <SsbjProgressBar ratio={overall.ratio} />
        <dl className="m-0 grid grid-cols-[3rem_1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
          {rows.map(row => (
            <div key={row.key} className="contents">
              <dt className="text-xs font-semibold text-text-muted">{row.label}</dt>
              <dd className="m-0"><SsbjProgressBar ratio={row.total === 0 ? 0 : row.done / row.total} /></dd>
              <dd className="m-0 text-right tabular-nums">{row.done} / {row.total}</dd>
            </div>
          ))}
        </dl>
        <p className="m-0 text-xs text-text-muted">
          文章は入力済みか非該当、判断は判断済み、根拠は根拠文書のある入力済みの文章を、済みとして数えます。
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">次にやること</h3>
        {steps.length === 0 ? (
          <p className="m-0 text-sm text-text-muted">残っている作業はありません。</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="ssbj-next-steps">
            {steps.map(step => (
              <li key={step.key}>
                <Link
                  href={ssbjReportPath(reportId, step.path)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:bg-muted"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-primary">{step.label}</span>
                    {step.note && <span className="text-xs text-text-muted">{step.note}</span>}
                  </span>
                  <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/** workingAccess = false（閲覧者）のときは、承認した保存版を見る画面だけを出す。 */
export const SsbjReportContentsNav = ({
  reportId, workingAccess = true, progress = null, withTabs = false,
}: SsbjReportContentsNavProps) => (
  <Card>
    <h2 className="m-0 mb-3 text-base font-bold">レポートの内容</h2>
    {workingAccess && progress && (
      <div className="mb-4">
        {progress.progress ? (
          <ProgressSummary reportId={reportId} progress={progress.progress} />
        ) : progress.errorMessage ? (
          <p role="alert" className="m-0 text-sm text-danger">進み具合を数えられませんでした（{progress.errorMessage}）</p>
        ) : (
          <p className="m-0 text-sm text-text-muted">進み具合を数えています...</p>
        )}
      </div>
    )}
    {withTabs ? (
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-text-muted">各画面でできること</summary>
        <div className="mt-3"><ContentsList reportId={reportId} workingAccess={workingAccess} /></div>
      </details>
    ) : (
      <ContentsList reportId={reportId} workingAccess={workingAccess} />
    )}
  </Card>
);
