'use client';

// レポートの中の画面（詳細・各入力画面・プレビュー・保存履歴・操作履歴）の上に共通で出す部品。レイアウト
// （app/(app)/ssbj/[reportId]/layout.tsx）が画面本体の前に描く（画面本体には手を入れない）。値は SsbjReportOverviewProvider が読んだものを使う。
// - 画面を移るタブ（入力の画面には進み具合の数）。閲覧者には閲覧できる画面のタブだけを、数を付けずに出す
// - 差し戻されて作成中に戻っているときは、最新の差戻しの理由・誰が・いつを帯で出す（閲覧者には出さない）
// 印刷ビューには何も出さない。

import { useSsbjReportOverview } from '../hooks/useSsbjReportOverview';
import { SsbjReopenNotice } from './SsbjReopenNotice.client';
import { SsbjReportTabs } from './SsbjReportTabs';

export const SsbjReportHeader = () => {
  const overview = useSsbjReportOverview();
  // ロールが分かるまでは出さない（閲覧者に作業中の内容の画面のタブを一瞬でも見せないため）。
  if (!overview || overview.route.isPrint || overview.role.isLoading) return null;
  const notice = overview.workingAccess ? overview.reopen.notice : null;
  return (
    <div data-testid="ssbj-report-header" className="flex flex-col gap-3 px-4 pt-4 md:px-[26px] md:pt-[22px]">
      <SsbjReportTabs
        reportId={overview.reportId}
        current={overview.route.current}
        workingAccess={overview.workingAccess}
        progress={overview.workingAccess ? overview.progress.progress : null}
      />
      {notice && <SsbjReopenNotice reportId={overview.reportId} notice={notice} current={overview.route.current} />}
    </div>
  );
};
