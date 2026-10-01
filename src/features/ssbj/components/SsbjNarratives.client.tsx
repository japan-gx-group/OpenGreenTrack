'use client';

// 四本柱と企業固有の補足の文章の画面（T05。/ssbj/[reportId]/narratives）。
// 要求項目マスターの文章の項目を章ごとに並べ、項目ごとに開示する文章と内部メモを編集する。
// 同じ章で文章以外の画面で答える要求（リスク・機会、GHG、基本情報など）は、どこで答えるかを案内する。
// 変更は作業中の内容で、保存版にはレポート詳細の「保存版を作成」で残す（docs/ssbj-spec.md §8）。
// 右側（SsbjEditorLayout）に、編集中の文章をその場で反映したプレビューと、OGT の値（参照用）を出す。

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, FileCheck2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useSsbjNarratives } from '../hooks/useSsbjNarratives';
import { useSsbjReport } from '../hooks/useSsbjReport';
import { saveSsbjNarrative } from '../services/narrativeService';
import {
  SSBJ_SECTION_IDS,
  SSBJ_SECTION_LABELS,
  type SsbjDisclosableText,
  type SsbjItemId,
  type SsbjRequirement,
  type SsbjSectionId,
} from '../types';
import { mergeSsbjNarrativeDrafts, ssbjNarrativeEntriesOfSection } from '../utils/narrative';
import { isSsbjReportLocked } from '../utils/reportStatus';
import { SSBJ_REQUIREMENTS } from '../utils/requirementMaster';
import { SsbjEditorLayout } from './SsbjEditorLayout.client';
import { SsbjLockedNotice } from './SsbjLockedNotice';
import { SsbjNarrativeItemCard } from './SsbjNarrativeItemCard.client';
import { SsbjTrialNotice } from './SsbjTrialNotice';

// 文章以外で答える要求の案内先（path はレポート配下のパス。null は画面で入力しないもの）。
const OTHER_TARGETS: Record<Exclude<SsbjRequirement['inputTarget']['kind'], 'narrative'>, { label: string; path: string | null }> = {
  basic_info: { label: '基本情報', path: '' },
  risks_opportunities: { label: 'リスク・機会', path: 'risks' },
  time_horizons: { label: 'リスク・機会（時間軸の定義）', path: 'risks' },
  ghg: { label: 'GHG排出量の候補値', path: 'ghg' },
  notice: { label: 'プレビュー・出力の注記（入力は不要）', path: null },
};

const OtherRequirements = ({ reportId, requirements }: { reportId: string; requirements: SsbjRequirement[] }) => {
  const others = requirements.filter(requirement => requirement.inputTarget.kind !== 'narrative');
  if (others.length === 0) return null;
  return (
    <div className="rounded-md border border-border px-4 py-3 text-xs text-text-muted">
      <p className="m-0 mb-1 font-semibold">この章のほかの要求（文章以外の画面で答えます）</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {others.map(requirement => {
          const kind = requirement.inputTarget.kind as keyof typeof OTHER_TARGETS;
          const target = OTHER_TARGETS[kind];
          return (
            <li key={requirement.id}>
              {requirement.id} {requirement.summary} →{' '}
              {target.path === null ? target.label : (
                <Link
                  href={`/ssbj/${encodeURIComponent(reportId)}${target.path ? `/${target.path}` : ''}`}
                  className="font-semibold text-primary hover:underline"
                >
                  {target.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export const SsbjNarratives = ({ reportId }: { reportId: string }) => {
  const { report, isLoading: reportLoading, errorMessage: reportError, isNotFound } = useSsbjReport(reportId);
  const { narratives, isLoading: narrativesLoading, errorMessage: narrativesError, replace } =
    useSsbjNarratives(report?.id ?? null);

  // 編集中（未保存）の文章。プレビューにだけ反映する。
  const [drafts, setDrafts] = useState<Partial<Record<SsbjItemId, SsbjDisclosableText>>>({});
  const handleDraftChange = useCallback((itemId: SsbjItemId, text: SsbjDisclosableText | null) => {
    setDrafts(prev => {
      if (text === null) {
        if (!(itemId in prev)) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: text };
    });
  }, []);

  const save = async (itemId: SsbjItemId, text: SsbjDisclosableText) => {
    if (!report) return;
    replace(await saveSsbjNarrative(report, itemId, text));
  };

  const requirementsOf = (sectionId: SsbjSectionId | null) =>
    SSBJ_REQUIREMENTS.filter(requirement => requirement.sectionId === sectionId);

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="四本柱の文章" description={report?.title ?? 'SSBJレポート'} showFiscalYear={false} primaryAction={null} />
      <div className="flex flex-col gap-4">
        <Link
          href={`/ssbj/${encodeURIComponent(reportId)}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} /> レポート詳細へ戻る
        </Link>
        <SsbjTrialNotice />
        {report && <SsbjLockedNotice report={report} />}
        {(reportError || narrativesError) && (
          <div role="alert" className="rounded-md bg-danger-light px-4 py-3 text-sm text-danger">
            {reportError || narrativesError}
          </div>
        )}
        {reportLoading || narrativesLoading ? (
          <Card><LoadingIndicator label="四本柱の文章を読み込んでいます..." /></Card>
        ) : isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <FileCheck2 aria-hidden="true" size={48} className="mb-3 text-text-muted opacity-50" />
            <p className="text-lg font-bold text-text-muted">SSBJレポートが見つかりません</p>
          </Card>
        ) : report && !narrativesError ? (
          <SsbjEditorLayout
            report={report}
            overrides={{ narratives: mergeSsbjNarrativeDrafts(narratives, drafts) }}
            hasUnsavedDrafts={Object.keys(drafts).length > 0}
          >
            <Card>
              <p className="m-0 text-sm text-text-muted">
                要求項目マスター（暫定版）の項目ごとに、開示する文章を書きます。1 つの文章で、一般開示基準と気候関連開示基準の
                同じ趣旨の要求にまとめて答えます。「〜していない」場合は、非該当ではなく「していない」と書いて入力済みにします。
                変更は作業中の内容で、保存版にはレポート詳細の「保存版を作成」で残します。
              </p>
              <nav aria-label="章" className="mt-3 flex flex-wrap gap-2">
                {SSBJ_SECTION_IDS.map(sectionId => (
                  <a key={sectionId} href={`#ssbj-narratives-${sectionId}`} className="text-sm font-semibold text-primary hover:underline">
                    {SSBJ_SECTION_LABELS[sectionId]}
                  </a>
                ))}
              </nav>
            </Card>
            {SSBJ_SECTION_IDS.map(sectionId => (
              <section key={sectionId} id={`ssbj-narratives-${sectionId}`} className="flex flex-col gap-3">
                <h2 className="m-0 text-base font-bold">{SSBJ_SECTION_LABELS[sectionId]}</h2>
                {ssbjNarrativeEntriesOfSection(sectionId, narratives).map(entry => (
                  <SsbjNarrativeItemCard
                    key={entry.itemId}
                    entry={entry}
                    onSave={save}
                    readOnly={isSsbjReportLocked(report.review)}
                    onDraftChange={handleDraftChange}
                  />
                ))}
                <OtherRequirements reportId={reportId} requirements={requirementsOf(sectionId)} />
              </section>
            ))}
            <section className="flex flex-col gap-3">
              <h2 className="m-0 text-base font-bold">全般</h2>
              <OtherRequirements reportId={reportId} requirements={requirementsOf(null)} />
            </section>
          </SsbjEditorLayout>
        ) : null}
      </div>
    </div>
  );
};
