'use client';

// 保存履歴の「内容を見る」で開く、保存版 1 件の表示。プレビューと同じ本文（SsbjPreviewDocument）で「レポートの形」に描き、
// 保存した項目を漏れなく確かめる「表で見る」（SsbjVersionContents）と、保存データそのものの「JSON」をタブで切り替える。
// 内部メモはプレビューの画面と同じく既定で隠し、「内部メモも表示する」を選んだときだけ 3 つのタブのどれにも出す
// （表と JSON は utils/disclosedSnapshot.ts で内部メモ・内部記録を除いた形にする）。
// 閲覧者には切替を出さない。閲覧者の保存版は、API が内部メモ・内部記録を除いて返したもの（docs/authorization-matrix.md §2.3）。

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { SsbjStoredVersion } from '../services/versionExportService';
import { toSsbjDisclosedSnapshot } from '../utils/disclosedSnapshot';
import { ssbjVersionPreviewSource } from '../utils/preview';
import { SsbjPreviewDocument } from './SsbjPreviewDocument';
import { SsbjVersionContents } from './SsbjVersionContents';

export const SsbjVersionView = ({
  version,
  approved,
  viewerOnly,
}: {
  version: SsbjStoredVersion;
  /** 承認した版か（見出しに印を出す）。 */
  approved: boolean;
  /** 閲覧者か。閲覧者には内部メモの表示の切替を出さない。 */
  viewerOnly: boolean;
}) => {
  const [showInternalNotes, setShowInternalNotes] = useState(false);
  const source = ssbjVersionPreviewSource(version);
  const showInternal = showInternalNotes && !viewerOnly;
  // 表と JSON も、内部メモを出さないときは開示する内容だけにする（レポートの形と同じものだけを見せる）。
  const shownVersion = showInternal || !source
    ? version
    : { ...version, snapshot: toSsbjDisclosedSnapshot(version.snapshot).snapshot };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-base font-bold">版 {version.versionNumber} の保存内容</h2>
        {approved && <Badge variant="success">承認した版</Badge>}
      </div>
      {!source ? (
        <p role="alert">対応していない保存版の形式です。</p>
      ) : (
        <Tabs defaultValue="report">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="report">レポートの形</TabsTrigger>
              <TabsTrigger value="table">表で見る</TabsTrigger>
              <TabsTrigger value="json">JSON</TabsTrigger>
            </TabsList>
            {!viewerOnly && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`ssbj-version-internal-${version.id}`}
                  checked={showInternalNotes}
                  onCheckedChange={checked => setShowInternalNotes(checked === true)}
                />
                <Label htmlFor={`ssbj-version-internal-${version.id}`}>内部メモも表示する（開示しない内容）</Label>
              </div>
            )}
          </div>
          <TabsContent value="report" className="mt-3">
            <SsbjPreviewDocument source={source} showInternalNotes={showInternal} />
          </TabsContent>
          <TabsContent value="table" className="mt-3">
            <SsbjVersionContents version={shownVersion} />
          </TabsContent>
          <TabsContent value="json" className="mt-3">
            <pre data-testid="ssbj-version-json" className="m-0 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border p-3 text-xs">
              {JSON.stringify(shownVersion.snapshot, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};
