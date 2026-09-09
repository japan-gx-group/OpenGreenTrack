'use client';

// 標準係数の候補セレクトと、確定した係数の詳細（係数値 / 出典 / 事業者 or 地域）。
// 候補は算定エンジンと同じ純関数（listFactorCandidates）で並び、先頭が優先順位による自動選択。

import React from 'react';
import type { CandidateFactorRow } from '../services/factorSelectionService';
import {
  factorNameWithValue,
  factorProviderOrRegionText,
  factorSourceText,
  factorValueText,
} from '../services/entryFormat';
import { EntryField } from './EntryFormPrimitives';

export interface StandardFactorFieldsProps {
  candidates: CandidateFactorRow[];
  /** 候補セレクトの value（ユーザーの選択） */
  selectedFactor: CandidateFactorRow | null;
  /** 供給事業者別モードで事業者未選択のとき true。ラベルを「代替値」表記にする */
  asFallback: boolean;
  onSelect: (factorId: string) => void;
}

export const StandardFactorFields = ({ candidates, selectedFactor, asFallback, onSelect }: StandardFactorFieldsProps) => (
  <EntryField
    htmlFor="manual-factor-select"
    label={asFallback ? '代替値（標準係数）' : '排出係数'}
    hint="(優先順位で自動選択・変更可)"
  >
    <select
      id="manual-factor-select"
      value={selectedFactor?.id ?? ''}
      onChange={(event) => onSelect(event.target.value)}
      className="gt-field"
    >
      {candidates.map((candidate, index) => (
        <option key={candidate.id} value={candidate.id}>
          {factorNameWithValue(candidate)}
          {index === 0 ? ' ・自動選択' : ''}
        </option>
      ))}
    </select>
  </EntryField>
);

/**
 * 確定した係数の詳細。上の「選ぶ」入力と区別できるよう罫線で区切る。
 * 左列に係数値、右列に「事業者（地域）→ 出典」を縦に並べる。
 * 出典は資料名込みで100文字近くなることがあり、均等 3 列では4行に折り返して読めないため、
 * 左列を係数値の文字幅（auto）まで縮め、残り幅をすべて右列に渡す。
 */
export const FactorDetailGrid = ({
  factor,
  provisional = false,
}: {
  factor: CandidateFactorRow;
  /** 対象年度が未公表で過年度の係数を暫定適用している。年度の隣にバッジを出す */
  provisional?: boolean;
}) => {
  const providerOrRegion = factorProviderOrRegionText(factor);
  return (
    <dl
      data-testid="manual-factor-detail"
      className="grid grid-cols-1 gap-x-5 gap-y-1.5 border-t border-border-light pt-3 text-sm md:grid-cols-[minmax(0,auto)_minmax(0,1fr)]"
    >
      <div className="md:row-span-2">
        <dt className="inline text-text-muted">係数値: </dt>
        <dd className="inline font-semibold text-text-main">{factorValueText(factor)}</dd>
      </div>
      <div>
        <dt className="inline text-text-muted">{providerOrRegion.label}: </dt>
        <dd className="inline font-medium text-text-main">{providerOrRegion.value}</dd>
      </div>
      <div>
        <dt className="inline text-text-muted">出典: </dt>
        <dd className="inline font-medium text-text-main">
          {factorSourceText(factor)}
          {provisional && (
            <span
              data-testid="factor-provisional-badge"
              className="ml-2 rounded bg-warning/10 px-1.5 py-0.5 text-xs font-semibold text-warning"
            >
              {factor.applicableYear}年度の係数を暫定適用
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
};
