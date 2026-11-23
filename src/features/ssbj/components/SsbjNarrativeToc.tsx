// ガバナンス・戦略等の文章の画面の目次。画面をスクロールしても上に付いてきて（スマホの幅では付いてこない。
// 左上のメニューのボタンと重なり、画面の高さを取りすぎるため）、章ごとの入力済みの数と、
// 項目ごとの開示する文章の状態（入力済み・未確認・非該当・未入力）を印で出す。印を押すとその項目へ移る。
// 「入力済みでない項目だけ表示」で、書き残しの項目だけに絞れる（絞り込みは画面の表示だけで、保存はしない）。
// 状態は保存済みの内容で数える（編集中の未保存の内容は数えない）。

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SSBJ_SECTION_LABELS, type SsbjFieldState, type SsbjSectionId } from '../types';
import { SSBJ_FIELD_STATE_LABELS } from '../utils/fieldValue';
import { ssbjNarrativeAnchorId, ssbjNarrativeProgress, type SsbjNarrativeEntry } from '../utils/narrative';

// 状態ごとの印の見た目。入力済みは塗り、未確認は注意の色、非該当は薄い塗り、未入力は枠だけ。
const MARK_CLASSES: Record<SsbjFieldState, string> = {
  answered: 'bg-primary border-primary',
  unconfirmed: 'bg-warning border-warning',
  not_applicable: 'bg-text-subtle border-text-subtle',
  unanswered: 'bg-bg-card border-text-muted',
};

const LEGEND: SsbjFieldState[] = ['answered', 'unconfirmed', 'not_applicable', 'unanswered'];

interface SsbjNarrativeTocProps {
  sections: { sectionId: SsbjSectionId; entries: SsbjNarrativeEntry[] }[];
  onlyUnanswered: boolean;
  onOnlyUnansweredChange: (value: boolean) => void;
}

export const SsbjNarrativeToc = ({ sections, onlyUnanswered, onOnlyUnansweredChange }: SsbjNarrativeTocProps) => {
  const total = ssbjNarrativeProgress(sections.flatMap(section => section.entries));
  return (
    <nav
      aria-label="目次"
      data-testid="ssbj-narrative-toc"
      className="z-10 flex flex-col md:sticky md:top-0 gap-2 rounded-lg border border-border bg-bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm font-semibold">
          入力済み <span className="tabular-nums">{total.answered} / {total.total}</span> 項目
        </p>
        <div className="flex items-center gap-2">
          <Checkbox
            id="ssbj-narratives-only-unanswered"
            checked={onlyUnanswered}
            onCheckedChange={checked => onOnlyUnansweredChange(checked === true)}
          />
          <Label htmlFor="ssbj-narratives-only-unanswered" className="text-xs">入力済みでない項目だけ表示</Label>
        </div>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 sm:flex-row sm:flex-wrap sm:gap-x-5">
        {sections.map(({ sectionId, entries }) => {
          const progress = ssbjNarrativeProgress(entries);
          return (
            <li key={sectionId} className="flex items-center gap-2">
              <a href={`#ssbj-narratives-${sectionId}`} className="text-xs font-semibold text-primary hover:underline">
                {SSBJ_SECTION_LABELS[sectionId]}
              </a>
              <span className="text-xs text-text-muted tabular-nums">{progress.answered}/{progress.total}</span>
              <span className="flex flex-wrap gap-1">
                {entries.filter(entry => entry.item !== null).map(entry => {
                  const state = entry.text.disclosure.state;
                  const label = `${entry.item?.label ?? entry.itemId}（${SSBJ_FIELD_STATE_LABELS[state]}）`;
                  return (
                    <a
                      key={entry.itemId}
                      href={`#${ssbjNarrativeAnchorId(entry.itemId)}`}
                      aria-label={label}
                      title={label}
                      data-state={state}
                      className={`block size-3 rounded-full border ${MARK_CLASSES[state]} hover:ring-2 hover:ring-primary/40`}
                    />
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="m-0 flex flex-wrap gap-3 text-[11px] text-text-muted" aria-hidden="true">
        {LEGEND.map(state => (
          <span key={state} className="inline-flex items-center gap-1">
            <span className={`inline-block size-2.5 rounded-full border ${MARK_CLASSES[state]}`} />
            {SSBJ_FIELD_STATE_LABELS[state]}
          </span>
        ))}
      </p>
    </nav>
  );
};
