'use client';

// 「② 排出係数の参照」ボックス。カテゴリから決まる参照方式（供給事業者別 / 標準 / IDEA）に応じて中身を切り替える。
// 骨格（見出し・チップ・状態文言の位置）は 3 方式で共通にし、ユーザーが覚える手順を 1 つにする。
// 表示する係数は「保存後の算定で実際に適用される係数」（applied）を基準にし、プレビューと算定結果を一致させる。

import React from 'react';
import { Calculator } from 'lucide-react';
import type { IdeaProductSelectionView } from '../hooks/useIdeaProductSelection';
import type { Scope12FactorSelectionView } from '../hooks/useScope12FactorSelection';
import type { FactorSource } from '../services/entryCategory';
import { IdeaFactorFields } from './IdeaFactorFields.client';
import { ProviderFactorFields } from './ProviderFactorFields.client';
import { FactorDetailGrid, StandardFactorFields } from './StandardFactorFields.client';

const SECTION_HINTS: Record<FactorSource, string> = {
  provider: '供給事業者を選ぶとその事業者の係数で計算します。未選択の場合は全国の代替値で計算します。',
  standard: '拠点・対象年月に合う標準係数を優先順位で自動選択します。候補から変更もできます。',
  idea: 'IDEA データベースから製品を検索して選ぶと、その製品の原単位で計算します。',
};

const NO_CANDIDATE_MESSAGE =
  'この条件（カテゴリ・対象年月・拠点）に適用できる排出係数が見つかりません。このまま保存した場合、排出量は未算定として記録されます。';
// 保存する係数指定が無く（編集で触れていない・取込レコード）、同順位の候補が複数ある。算定バッチは
// 当てずっぽうを避けて FACTOR_AMBIGUOUS で未算定にするため、候補セレクトからの選択を促す。
const AMBIGUOUS_MESSAGE =
  '該当する排出係数が複数あり自動では決められません。候補から排出係数を選択してください。このまま保存した場合、排出量は未算定として記録されます。';
// 対象年度の公式係数がまだ公表されていないため、直近の過年度の係数で暫定的に計算している。
// 公表後に新しい係数を登録しても、暫定適用で算定済みの結果は自動では置き換わらない
// （算定バッチは未算定レコードしか処理しない）。データ入力画面のバナーから
// 「正式係数で再算定」を実行してもらう必要があるため、自動で切り替わるとは書かない。
const PROVISIONAL_MESSAGE =
  '対象年月の年度の排出係数がまだ公表されていないため、前年度の係数を暫定的に適用しています。新しい係数が登録されたら、データ入力画面の案内から「正式係数で再算定」を実行すると新しい値に切り替わります。';
// 保存されていた事業者別係数が年度更新で入れ替わり、同じ供給事業者・メニューの当年度の係数へ読み替えられた。
// 自動選択（代替値）に落ちるのではなく契約先の係数が保たれるため、フォールバックとは分けて知らせる。
const REMAPPED_MESSAGE =
  'このレコードに保存されていた排出係数は年度更新で入れ替わったため、同じ供給事業者・メニューの現在の係数で再計算されます。';

export interface ActivityEntryFactorSectionProps {
  factorSource: FactorSource;
  /** 対象年月が検証を通っている（係数を引ける） */
  hasPeriod: boolean;
  /** 会計年度マスタが確定している。未確定の間は Scope1/2 の係数を取得しない */
  fiscalYearsReady: boolean;
  isEdit: boolean;
  scope12: Scope12FactorSelectionView;
  idea: IdeaProductSelectionView;
}

export const ActivityEntryFactorSection = ({
  factorSource,
  hasPeriod,
  fiscalYearsReady,
  isEdit,
  scope12,
  idea,
}: ActivityEntryFactorSectionProps) => {
  const isIdea = factorSource === 'idea';
  const applied = scope12.applied;
  const savedFactorKept = isEdit && !scope12.factorTouched;

  return (
    <div
      data-testid="manual-factor-section"
      className="flex flex-col gap-4 rounded-md border border-border-light bg-bg-subtle p-5"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Calculator size={16} className="text-primary" />
          <span className="text-sm font-semibold text-text-heading">
            {isIdea ? '適用する原単位' : '適用する排出係数'}
          </span>
        </div>
        <p className="text-xs text-text-muted">{SECTION_HINTS[factorSource]}</p>
      </div>

      {isIdea ? (
        <IdeaFactorFields idea={idea} />
      ) : !hasPeriod ? (
        // 対象年月が確定していない間は係数を引けない。エラー本文は入力直下に出すため、
        // ここでは何を直せば表示されるかだけを案内する。
        <p className="text-sm text-text-muted">対象年月を正しく選択すると適用係数を表示します。</p>
      ) : scope12.factorLoadError ? (
        <p className="text-sm text-danger">
          {scope12.factorLoadError}{' '}
          <button type="button" onClick={scope12.retryFactors} className="font-medium text-primary underline">
            再試行
          </button>
        </p>
      ) : !fiscalYearsReady || scope12.isLoadingFactors ? (
        // E2E の同期点。この文言はフォーム内でここ 1 箇所だけに出す（事業者リスト取得中には出さない）。
        <p className="text-sm text-text-muted">排出係数を取得しています...</p>
      ) : (
        <>
          {factorSource === 'provider' && (
            <ProviderFactorFields
              providerOptions={scope12.providerOptions}
              menuOptions={scope12.menuOptions}
              selection={scope12.providerSelection}
              providerFactor={scope12.providerFactor}
              isLoadingProviders={scope12.isLoadingProviders}
              providerLoadFailed={scope12.providerLoadFailed}
              onRetryProviders={scope12.retryProviders}
              onFactorTypeChange={scope12.setFactorType}
              onProviderChange={scope12.setProviderName}
              onMenuChange={scope12.setMenuName}
            />
          )}

          {scope12.providerFactor === null &&
            (scope12.factorCandidates.length === 0 ? (
              <p className="text-sm text-warning">{NO_CANDIDATE_MESSAGE}</p>
            ) : (
              <StandardFactorFields
                candidates={scope12.factorCandidates}
                selectedFactor={scope12.selectedFactor}
                asFallback={factorSource === 'provider'}
                onSelect={scope12.selectFactorId}
              />
            ))}

          {applied.status === 'pending' && (
            <p className="text-sm text-text-muted">保存されている係数を確認しています（事業者リストを取得中）...</p>
          )}
          {applied.status === 'unknown' && applied.reason === 'provider' && (
            <p className="text-sm text-warning">
              事業者リストを取得できなかったため、保存されている係数の内容を表示できません。係数を変更せずに保存すると元の係数指定を維持します。{' '}
              <button type="button" onClick={scope12.retryProviders} className="font-medium text-primary underline">
                再試行
              </button>
            </p>
          )}
          {applied.status === 'resolved' && applied.ambiguous && (
            <p className="text-sm text-warning">{AMBIGUOUS_MESSAGE}</p>
          )}
          {applied.status === 'resolved' && applied.factor && (
            <FactorDetailGrid factor={applied.factor} provisional={applied.provisional} />
          )}
          {applied.status === 'resolved' && applied.provisional && (
            <p className="text-sm text-warning">{PROVISIONAL_MESSAGE}</p>
          )}
          {applied.status === 'resolved' && applied.remapped && (
            <p className="text-sm text-warning">{REMAPPED_MESSAGE}</p>
          )}
          {applied.status === 'resolved' && applied.fellBack && !applied.remapped && (
            <p className="text-sm text-warning">
              {savedFactorKept
                ? 'このレコードに保存されていた排出係数は、現在の条件（カテゴリ・対象年月・有効期間）では適用できません。保存すると優先順位で自動選択された係数で再計算されます。'
                : '選択した係数は対象年月の有効期間外のため算定に使われません。保存すると優先順位で自動選択された係数（代替値）で計算されます。'}
            </p>
          )}
        </>
      )}
    </div>
  );
};
