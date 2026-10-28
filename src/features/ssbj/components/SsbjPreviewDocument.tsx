// SSBJ レポートのプレビュー本文（T12。表示のみ）。保存版、または作業中の内容を保存版と同じ形に組み立てたものから描く。
// 画面と印刷ビュー（PDF）で同じものを使う。どちらを表示しているか（作業中 / 保存版）を先頭に必ず出す。
// プレビューが描けないセクションは黙って落とさず、名前を出して知らせる（出力漏れを見落とさないため）。

import { formatDateTime } from '@/lib/datetime';
import type { SsbjPreviewSource } from '../services/previewService';
import { SSBJ_SECTION_LABELS } from '../types';
import { scope2BasisTotalsOf } from '../utils/ogtValue';
import { unsupportedPreviewSections } from '../utils/preview';
import { SsbjPreviewEvidence } from './SsbjPreviewEvidence';
import { SsbjPreviewExternalEmissions } from './SsbjPreviewExternalEmissions';
import { SsbjPreviewGhg } from './SsbjPreviewGhg';
import { SsbjPreviewJudgements } from './SsbjPreviewJudgements';
import { SsbjPreviewNarratives } from './SsbjPreviewNarratives';
import { SsbjPreviewRisks, SsbjPreviewTimeHorizons } from './SsbjPreviewStrategy';
import { SsbjReportBasicInfo } from './SsbjReportBasicInfo';

const NOTES = [
  'このプレビューは社内確認用の試行版です。SSBJ 基準への準拠や、対外提出の完了を保証しません（準拠しているとは記述しません）。',
  'OGT の公式係数は実質 CO2 のみを対象としており、7 種類の温室効果ガスを CO2 相当に集約した値ではありません。',
];
const NOTES_AFTER_SCOPE2 = [
  '「算定済み」は登録済みのデータがすべて算定済みという意味で、データが網羅されていることは意味しません。',
];

// Scope 2 の注記は、その版が基準別の値を持つかどうかで変える（基準別の値を取り込む前の保存版は区別なしのまま）。
// 「外部で算定した排出量」の Scope 2 は基準ごとの値なので、どちらの注記でも、文書全体に基準別の値が無いとは書かない。
const SCOPE2_NOTE_WITH_BASIS =
  'OGT の Scope 2 算定値は、ロケーション基準・マーケット基準の値と、温対法の係数区分による基準の区別のない値を併記しています。「未算定」の基準の値は含みません。「外部で算定した排出量」の Scope 2 は、OGT の値とは別に示しています（足し合わせていません）。';
const SCOPE2_NOTE_WITHOUT_BASIS =
  'OGT の Scope 2 算定値は、ロケーション基準・マーケット基準を区別していません（基準不明）。基準ごとの Scope 2 は、「外部で算定した排出量」に示したものだけです。';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="report-print-section flex flex-col gap-3">
    <h2 className="report-print-section-heading m-0">{title}</h2>
    {children}
  </section>
);

const sourceDescription = (source: SsbjPreviewSource): string =>
  source.kind === 'working'
    ? `作業中の内容（保存版になっていない変更を含みます。作業中の版数 ${source.draftRevision}）`
    : `保存版 第${source.versionNumber}版（${formatDateTime(source.createdAt)} 保存。版ID ${source.versionId}）`;

export const SsbjPreviewDocument = ({
  source,
  showInternalNotes,
}: {
  source: SsbjPreviewSource;
  showInternalNotes: boolean;
}) => {
  const { report, sections } = source.snapshot;
  const unsupported = unsupportedPreviewSections(source.snapshot);
  const scope2WithBasis = !!sections.ghg && scope2BasisTotalsOf(sections.ghg.values) !== null;

  return (
    <article className="flex flex-col gap-2">
      <header className="report-print-header">
        <p className="m-0 text-xs font-semibold text-text-muted">SSBJ 開示レポート（社内確認用の試行版）</p>
        <h1 className="report-print-title m-0 mt-1">{report.title}</h1>
        <p
          data-testid="ssbj-preview-source"
          className={source.kind === 'working'
            ? 'm-0 rounded-md bg-warning-soft px-3 py-2 text-sm font-semibold text-warning'
            : 'm-0 rounded-md bg-primary-light px-3 py-2 text-sm font-semibold text-primary'}
        >
          {sourceDescription(source)}
        </p>
      </header>

      <Section title="基本情報">
        <SsbjReportBasicInfo report={report} />
      </Section>

      <Section title={SSBJ_SECTION_LABELS.governance}>
        <SsbjPreviewNarratives sectionId="governance" narratives={sections.narratives} showInternalNotes={showInternalNotes} />
      </Section>

      <Section title={SSBJ_SECTION_LABELS.strategy}>
        <SsbjPreviewNarratives sectionId="strategy" narratives={sections.narratives} showInternalNotes={showInternalNotes} />
        <h3 className="m-0 text-sm font-bold">リスク及び機会</h3>
        <SsbjPreviewRisks items={sections.risks_opportunities} showInternalNotes={showInternalNotes} />
        <h3 className="m-0 mt-2 text-sm font-bold">時間軸の定義</h3>
        <SsbjPreviewTimeHorizons definitions={sections.time_horizons} showInternalNotes={showInternalNotes} />
      </Section>

      <Section title={SSBJ_SECTION_LABELS.risk_management}>
        <SsbjPreviewNarratives sectionId="risk_management" narratives={sections.narratives} showInternalNotes={showInternalNotes} />
      </Section>

      <Section title={SSBJ_SECTION_LABELS.metrics_targets}>
        <h3 className="m-0 text-sm font-bold">温室効果ガス排出</h3>
        <SsbjPreviewGhg ghg={sections.ghg} />
        <h3 className="m-0 mt-2 text-sm font-bold">外部で算定した排出量</h3>
        <SsbjPreviewExternalEmissions
          items={sections.external_emissions}
          showInternalNotes={showInternalNotes}
          scope2WithBasis={scope2WithBasis}
        />
        <h3 className="m-0 mt-2 text-sm font-bold">そのほかの指標・目標・測定方法の説明</h3>
        <SsbjPreviewNarratives sectionId="metrics_targets" narratives={sections.narratives} showInternalNotes={showInternalNotes} />
      </Section>

      <Section title="該当性・重要性・記載しない理由">
        <SsbjPreviewJudgements judgements={sections.judgements} showInternalNotes={showInternalNotes} />
      </Section>

      <Section title="根拠文書">
        <SsbjPreviewEvidence items={sections.evidence} showInternalNotes={showInternalNotes} />
      </Section>

      {unsupported.length > 0 && (
        <Section title="プレビューに表示していない項目">
          <p role="alert" className="m-0 text-sm text-danger">
            この内容には、プレビューがまだ表示に対応していない項目があります（{unsupported.join('、')}）。
            内容は保存版に残っています。
          </p>
        </Section>
      )}

      <Section title="注記">
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          {NOTES.map(note => <li key={note}>{note}</li>)}
          {/* OGT の値を採用していない版には、OGT の Scope 2 の注記を出さない（今の OGT は基準別の値を持つので、「基準不明」は事実と違う）。 */}
          {sections.ghg && <li>{scope2WithBasis ? SCOPE2_NOTE_WITH_BASIS : SCOPE2_NOTE_WITHOUT_BASIS}</li>}
          {NOTES_AFTER_SCOPE2.map(note => <li key={note}>{note}</li>)}
          {sections.ghg && sections.ghg.supplierReferences.length > 0 && (
            <li>サプライヤー別排出量は参考値であり、Scope 3 の合計には含めていません。</li>
          )}
        </ul>
      </Section>
    </article>
  );
};
