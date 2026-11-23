'use client';

// 保存履歴の「版を比べる」。2 つの保存版を選び、変わった項目だけを並べる（新しい URL は作らず、保存履歴の画面の中に出す）。
// 既定は「最新のレビュー依頼より前の最後の版 → 最新の版」（依頼の時点が分からなければ 1 つ前の版 → 最新の版）。依頼の日時は開くたびに読み直す。
// 選んだ 2 つの版は版番号の小さい順に並べて比べる（「前の版」に新しい版を選んだら入れ替え、その旨を出す）。同じ版どうしは読まない。
// 文章は文字の差分（追加・削除の色分け）、判断・GHG の採用値・リスク・機会などは「前 → 後」。差分の計算は utils/versionDiff.ts。
// 項目ごとの「見た」は画面の中だけの印で、保存しない。
// 閲覧者には出さない（閲覧者が見られるのは承認した版だけで、比べる相手が無い。操作履歴も読めない）。呼び出し元が出し分ける。
// 内部メモ・内部記録の変化は、プレビューと同じく既定で隠し、選んだときだけ出す。

import { useMemo, useState } from 'react';
import { GitCompare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDateTime } from '@/lib/datetime';
import { useSsbjLatestReviewRequest } from '../hooks/useSsbjLatestReviewRequest';
import { useSsbjVersionPair } from '../hooks/useSsbjVersionPair';
import type { SsbjVersionSummary } from '../services/versionExportService';
import { toSsbjDisclosedSnapshot } from '../utils/disclosedSnapshot';
import { ssbjVersionPreviewSource } from '../utils/preview';
import {
  defaultSsbjCompareVersions,
  diffSsbjSnapshots,
  orderSsbjCompareVersions,
  type SsbjVersionChange,
  type SsbjVersionFieldChange,
} from '../utils/versionDiff';

const STATUS_LABELS: Record<SsbjVersionChange['status'], string | null> = {
  added: 'この版で追加',
  removed: 'この版で削除',
  changed: null,
};

const FieldChange = ({ field }: { field: SsbjVersionFieldChange }) => (
  <div className="flex flex-col gap-1">
    <p className="m-0 text-xs font-semibold text-text-muted">{field.label}</p>
    {field.kind === 'text' ? (
      <p className="m-0 whitespace-pre-wrap text-sm" data-testid="ssbj-version-text-diff">
        {field.parts.map((part, index) => part.kind === 'same' ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === 'added' ? (
          <ins key={index} className="rounded-sm bg-success-soft text-success no-underline">{part.text}</ins>
        ) : (
          <del key={index} className="rounded-sm bg-danger-light text-danger">{part.text}</del>
        ))}
      </p>
    ) : (
      <p className="m-0 whitespace-pre-wrap text-sm">
        <span className="text-text-muted">{field.before}</span>
        <span aria-label="から" className="mx-2 text-text-muted">→</span>
        <span className="font-semibold">{field.after}</span>
      </p>
    )}
  </div>
);

const ChangeItem = ({
  change,
  seen,
  onSeenChange,
}: {
  change: SsbjVersionChange;
  seen: boolean;
  onSeenChange: (seen: boolean) => void;
}) => {
  const checkboxId = `ssbj-version-seen-${change.key}`;
  const statusLabel = STATUS_LABELS[change.status];
  return (
    <li data-testid="ssbj-version-change" className={seen ? 'rounded-lg border border-border p-3 opacity-60' : 'rounded-lg border border-border p-3'}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-xs text-text-muted">{change.group}</p>
          <p className="m-0 text-sm font-bold">
            {change.title}
            {change.id && <span className="ml-2 text-xs font-normal text-text-muted">{change.id}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusLabel && <Badge variant={change.status === 'added' ? 'success' : 'danger'}>{statusLabel}</Badge>}
          <div className="flex items-center gap-2">
            <Checkbox id={checkboxId} checked={seen} onCheckedChange={checked => onSeenChange(checked === true)} />
            <Label htmlFor={checkboxId}>見た</Label>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {change.fields.map((field, index) => <FieldChange key={index} field={field} />)}
      </div>
    </li>
  );
};

export const SsbjVersionCompare = ({ reportId, versions }: { reportId: string; versions: SsbjVersionSummary[] }) => {
  const [isOpen, setIsOpen] = useState(false);
  /** 開いた回数。開くたびに最新のレビュー依頼を読み直すためのキー。 */
  const [openCount, setOpenCount] = useState(0);
  const [selection, setSelection] = useState<{ fromId: string; toId: string } | null>(null);
  const [showInternal, setShowInternal] = useState(false);
  const [seenKeys, setSeenKeys] = useState<ReadonlySet<string>>(new Set());
  const request = useSsbjLatestReviewRequest(isOpen ? reportId : null, openCount);
  const defaults = request.isLoading ? null : defaultSsbjCompareVersions(versions, request.requestedAt);
  // 選んだ版が保存履歴から消えていれば（読み直しなど）、既定の組に戻す。
  const selected = selection && versions.some(version => version.id === selection.fromId) &&
    versions.some(version => version.id === selection.toId) ? selection : null;
  const chosenFromId = selected?.fromId ?? defaults?.fromId ?? null;
  const chosenToId = selected?.toId ?? defaults?.toId ?? null;
  // 逆向きの差分にしないよう、版番号の小さい順に並べる。選択の表示もこの順にする。
  const ordered = chosenFromId && chosenToId ? orderSsbjCompareVersions(versions, chosenFromId, chosenToId) : null;
  const fromId = ordered?.fromId ?? null;
  const toId = ordered?.toId ?? null;
  const sameVersion = fromId !== null && fromId === toId;
  const pair = useSsbjVersionPair(isOpen && !sameVersion ? reportId : null, fromId, toId);

  const diff = useMemo(() => {
    if (!pair.before || !pair.after) return null;
    const before = ssbjVersionPreviewSource(pair.before);
    const after = ssbjVersionPreviewSource(pair.after);
    if (!before || !after) return 'unsupported' as const;
    return showInternal
      ? diffSsbjSnapshots(before.snapshot, after.snapshot)
      : diffSsbjSnapshots(toSsbjDisclosedSnapshot(before.snapshot).snapshot, toSsbjDisclosedSnapshot(after.snapshot).snapshot);
  }, [pair.before, pair.after, showInternal]);

  const numberOf = (id: string | null) => versions.find(version => version.id === id)?.versionNumber ?? '';
  const changes = diff && diff !== 'unsupported' ? diff.changes : [];
  const seenCount = changes.filter(change => seenKeys.has(change.key)).length;
  const select = (next: { fromId: string; toId: string }) => {
    setSelection(next);
    setSeenKeys(new Set());
  };
  const markSeen = (key: string, seen: boolean) => setSeenKeys(current => {
    const next = new Set(current);
    if (seen) next.add(key);
    else next.delete(key);
    return next;
  });

  return (
    <Card data-testid="ssbj-version-compare">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-base font-bold">版を比べる</h2>
          <p className="m-0 text-sm text-text-muted">2 つの保存版を選ぶと、変わった項目だけを並べます。</p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          if (!isOpen) setOpenCount(count => count + 1);
          setIsOpen(!isOpen);
        }}>
          <GitCompare size={14} /> {isOpen ? '比べるのをやめる' : '版を比べる'}
        </Button>
      </div>
      {isOpen && (
        <div className="mt-4 flex flex-col gap-4">
          {request.isLoading ? <LoadingIndicator label="比べる版を決めています..." /> : (
            <>
              <div className="flex flex-wrap items-end gap-4">
                {(['fromId', 'toId'] as const).map(side => (
                  <div key={side} className="flex min-w-56 flex-col gap-1">
                    <Label htmlFor={`ssbj-compare-${side}`}>{side === 'fromId' ? '前の版' : '後の版'}</Label>
                    <Select
                      value={(side === 'fromId' ? fromId : toId) ?? undefined}
                      onValueChange={value => fromId && toId && select({ fromId, toId, [side]: value })}
                    >
                      <SelectTrigger id={`ssbj-compare-${side}`} className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {versions.map(version => (
                          <SelectItem key={version.id} value={version.id}>
                            版 {version.versionNumber}（{formatDateTime(version.createdAt)}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox
                    id={`ssbj-compare-internal-${reportId}`}
                    checked={showInternal}
                    onCheckedChange={checked => setShowInternal(checked === true)}
                  />
                  <Label htmlFor={`ssbj-compare-internal-${reportId}`}>内部メモ・内部記録の変更も表示する</Label>
                </div>
              </div>
              {!selected && defaults && (
                <p data-testid="ssbj-compare-basis" className="m-0 text-xs text-text-muted">
                  {defaults.basis === 'request'
                    ? `最新のレビュー依頼（${request.requestedAt ? formatDateTime(request.requestedAt) : ''}）より前の最後の版と、最新の版を比べています。`
                    : '1 つ前の版と、最新の版を比べています。'}
                </p>
              )}
              {ordered?.swapped && (
                <p data-testid="ssbj-compare-swapped" className="m-0 text-xs text-warning">
                  前の版に新しい版を選んだため、版番号の小さい順に入れ替えて比べています。
                </p>
              )}
              {pair.errorMessage && <p role="alert" className="m-0 text-sm text-danger">{pair.errorMessage}</p>}
              {sameVersion ? (
                <p className="m-0 text-sm text-text-muted">同じ版です。別の版を選んでください。</p>
              ) : pair.isLoading ? (
                <LoadingIndicator label="保存版を読み込んでいます..." />
              ) : diff === 'unsupported' ? (
                <p role="alert" className="m-0 text-sm text-danger">対応していない保存版の形式のため、比べられません。</p>
              ) : diff && (
                <>
                  <p data-testid="ssbj-compare-summary" className="m-0 text-sm font-semibold">
                    版 {numberOf(fromId)} → 版 {numberOf(toId)} ・ 変更 {changes.length} 項目
                    {changes.length > 0 && <span className="ml-2 font-normal text-text-muted">（見た {seenCount} / {changes.length}）</span>}
                  </p>
                  {diff.uncompared.length > 0 && (
                    <p className="m-0 text-xs text-warning">
                      片方の版に含まれていないため、比べていない項目があります（{diff.uncompared.join('、')}）。
                    </p>
                  )}
                  {changes.length === 0 ? (
                    <p className="m-0 text-sm text-text-muted">変更はありません。</p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-3 p-0">
                      {changes.map(change => (
                        <ChangeItem
                          key={change.key}
                          change={change}
                          seen={seenKeys.has(change.key)}
                          onSeenChange={seen => markSeen(change.key, seen)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
};
