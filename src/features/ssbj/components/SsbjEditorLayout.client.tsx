'use client';

// SSBJ の入力画面の 2 画面構成（docs/ssbj-spec.md §13「2 画面のエディタ」）。左に入力、右にタブで
// 「プレビュー」（入力中の内容をその場で反映した、レポートの形の表示）と「OGT の値」（参照用のカンペ）を出す。
// 採用した OGT の値が採用後に変わっていれば、入力画面の上部で知らせる。
//
// プレビューは、作業中の内容（サーバで組み立てたもの）を土台に、この画面が持っている最新の入力（保存済みの一覧と、
// 編集中で未保存の内容）を overrides で重ねて描く。保存はしない。別の画面で変えた内容は「読み直す」で取り込む。
//
// itemFocus を渡す画面（文章の画面）では、左で扱っている項目が右のプレビューで見えていなければ、右の枠をそこまで
// スクロールする（右の枠だけを動かし、左の入力の位置は変えない。右が枠で区切られない狭い画面では動かさない）。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOgtAdoption } from '../hooks/useOgtAdoption';
import { useOgtCandidates } from '../hooks/useOgtCandidates';
import { useSsbjPreviewSource } from '../hooks/useSsbjPreviewSource';
import type { SsbjPreviewSource } from '../services/previewService';
import type { SsbjReportWorkingRecord, SsbjSnapshotSections } from '../types';
import { SSBJ_PREVIEW_ITEM_ATTRIBUTE, ssbjPreviewScrollTop, ssbjScrollBehavior } from '../utils/editorScroll';
import { changedOgtValueLabels } from '../utils/ogtAdoption';
import { SsbjOgtChangeBanner } from './SsbjOgtChangeBanner';
import { SsbjOgtReferencePanel } from './SsbjOgtReferencePanel';
import { SsbjPreviewDocument } from './SsbjPreviewDocument';
import type { SsbjPreviewItemFocus } from './SsbjPreviewNarratives';

const WORKING = { kind: 'working' } as const;

/** 土台のプレビューに、この画面の最新の入力を重ねる。 */
export const overlaySsbjPreview = (
  source: SsbjPreviewSource,
  report: SsbjReportWorkingRecord,
  overrides: Partial<SsbjSnapshotSections>,
): SsbjPreviewSource => {
  if (source.kind !== 'working') return source;
  return {
    ...source,
    snapshot: {
      ...source.snapshot,
      // 基本情報も画面が持っている最新の値にする（状態・版数の列は表示に使われないので、そのまま重ねてよい）。
      report: { ...source.snapshot.report, ...report },
      sections: { ...source.snapshot.sections, ...overrides },
    },
  };
};

interface SsbjEditorLayoutProps {
  report: SsbjReportWorkingRecord;
  /** この画面が持っている最新の入力（保存済みの一覧・編集中の内容）。プレビューで土台の内容の代わりに使う。 */
  overrides: Partial<SsbjSnapshotSections>;
  /** 編集中で未保存の入力をプレビューに含めているか。 */
  hasUnsavedDrafts?: boolean;
  /** 右側を最初から開いておくか（横に広い表の画面では閉じておく）。 */
  defaultPanelOpen?: boolean;
  /** 左の入力と右のプレビューの項目を結ぶ（文章の画面）。 */
  itemFocus?: SsbjPreviewItemFocus;
  children: ReactNode;
}

export const SsbjEditorLayout = ({
  report, overrides, hasUnsavedDrafts = false, defaultPanelOpen = true, itemFocus, children,
}: SsbjEditorLayoutProps) => {
  const [isPanelOpen, setIsPanelOpen] = useState(defaultPanelOpen);
  const [showInternalNotes, setShowInternalNotes] = useState(false);
  const preview = useSsbjPreviewSource(report.id, WORKING);
  const ogt = useOgtCandidates(report);
  const { adoption } = useOgtAdoption(report.id);
  const changedLabels = adoption && ogt.data ? changedOgtValueLabels(adoption, ogt.data.candidates, ogt.data.suppliers) : [];
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeItemId = itemFocus?.activeItemId ?? null;
  const hasPreview = preview.source !== null;

  // 左で扱う項目が変わったら、右のプレビューをその項目まで動かす。
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!activeItemId || !scroller || scroller.scrollHeight <= scroller.clientHeight) return;
    const target = scroller.querySelector(`[${SSBJ_PREVIEW_ITEM_ATTRIBUTE}="${activeItemId}"]`);
    if (!target) return;
    const top = ssbjPreviewScrollTop(scroller.getBoundingClientRect(), target.getBoundingClientRect(), scroller.scrollTop);
    if (top !== null) scroller.scrollTo?.({ top, behavior: ssbjScrollBehavior() });
  }, [activeItemId, hasPreview, isPanelOpen]);

  return (
    <div className="flex flex-col gap-4">
      <SsbjOgtChangeBanner reportId={report.id} changedLabels={changedLabels} />
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={() => setIsPanelOpen(open => !open)}>
          {isPanelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          {isPanelOpen ? 'プレビューと OGT の値を閉じる' : 'プレビューと OGT の値を開く'}
        </Button>
      </div>
      <div className={isPanelOpen ? 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'flex flex-col gap-4'}>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        {isPanelOpen && (
          <aside aria-label="プレビューと OGT の値" className="min-w-0 xl:sticky xl:top-0 xl:self-start">
            <Card ref={scrollerRef} className="xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
              <Tabs defaultValue="preview">
                <TabsList>
                  <TabsTrigger value="preview">プレビュー</TabsTrigger>
                  <TabsTrigger value="ogt">OGT の値</TabsTrigger>
                </TabsList>
                <TabsContent value="preview" className="mt-3 flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`ssbj-editor-internal-${report.id}`}
                        checked={showInternalNotes}
                        onCheckedChange={checked => setShowInternalNotes(checked === true)}
                      />
                      <Label htmlFor={`ssbj-editor-internal-${report.id}`}>内部メモも表示する</Label>
                    </div>
                    <Button type="button" variant="outline" size="sm" disabled={preview.isLoading} onClick={preview.reload}>
                      <RefreshCw size={14} /> 読み直す
                    </Button>
                  </div>
                  {hasUnsavedDrafts && (
                    <p data-testid="ssbj-editor-unsaved" className="m-0 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                      入力中で未保存の文章も表示しています。保存するまで、作業中の内容・保存版には入りません。
                    </p>
                  )}
                  {preview.errorMessage && <p role="alert" className="m-0 text-sm text-danger">{preview.errorMessage}</p>}
                  {preview.source ? (
                    <div data-testid="ssbj-editor-preview">
                      <SsbjPreviewDocument
                        source={overlaySsbjPreview(preview.source, report, overrides)}
                        showInternalNotes={showInternalNotes}
                        itemFocus={itemFocus}
                      />
                    </div>
                  ) : !preview.errorMessage && <LoadingIndicator label="プレビューを読み込んでいます..." />}
                </TabsContent>
                <TabsContent value="ogt" className="mt-3">
                  <SsbjOgtReferencePanel
                    reportId={report.id}
                    data={ogt.data}
                    adoption={adoption}
                    changedLabels={changedLabels}
                    isLoading={ogt.isLoading}
                    errorMessage={ogt.errorMessage}
                    onRefresh={ogt.refresh}
                  />
                </TabsContent>
              </Tabs>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
};
