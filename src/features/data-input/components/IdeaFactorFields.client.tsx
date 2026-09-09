'use client';

// Scope3 積上げ（IDEA 連携）の製品検索 UI と、選択製品の原単位の詳細。
// カテゴリ（1〜15）→ IDEA 製品検索（searchIdeaProducts + SearchableSelect のサーバーサイド検索・debounce）
// → 活動量 の順に入力する。単位は選択製品から自動設定し編集不可（受け入れ条件）。

import React from 'react';
import { Info } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/SearchableSelect.client';
import { SCOPE3_FACTOR_MISSING_MESSAGE } from '@/features/calculation/services/scope3Calculation';
import type { IdeaProductSelectionView } from '../hooks/useIdeaProductSelection';
import { ideaFactorValueText, ideaSourceText } from '../services/entryFormat';
import { EntryNotice } from './EntryFormPrimitives';

export const IdeaFactorFields = ({ idea }: { idea: IdeaProductSelectionView }) => (
  <>
    {/* §4.3 入力粒度の推奨（受け入れ条件のヘルプ表示） */}
    <div className="flex items-start gap-2 text-sm text-text-muted">
      <Info size={16} className="mt-0.5 shrink-0 text-primary" />
      <p>
        明細1行ずつではなく、
        <span className="font-semibold text-text-main">月次 × 製品で数量を合算した集約入力</span>
        を推奨します。同じ製品を同月に複数回購入した場合は、合計量を1行で登録してください
        （明細件数を抑え、集計・確認がしやすくなります）。
      </p>
    </div>

    {idea.hasActiveImport === false && (
      <EntryNotice variant="warning">
        IDEAデータベースが未取込のため、製品を検索できません。係数管理画面の
        「IDEAデータベース」カードから IDEA ファイルを取り込んでください。
      </EntryNotice>
    )}

    <div>
      <label className="mb-1.5 block text-sm font-medium text-text-muted" htmlFor="manual-product-select">
        IDEA製品 <span className="font-normal">(製品名またはIDEA製品コードで検索)</span>
      </label>
      <SearchableSelect
        id="manual-product-select"
        ariaDescribedBy="manual-product-select-help"
        options={idea.selectOptions}
        value={idea.selectedProductId}
        onChange={idea.selectProduct}
        onQueryChange={idea.setSearchQuery}
        disableClientFilter
        emptyMessage={
          idea.isSearching ? '検索しています...' : (idea.searchError ?? '該当する製品が見つかりません')
        }
        placeholder={idea.hasActiveImport === false ? 'IDEAデータベースが未取込です' : '例: 米、鋼材、輸送 など'}
        disabled={idea.hasActiveImport === false}
      />
      <p id="manual-product-select-help" className="mt-1.5 text-xs text-text-muted">
        取り込んだ IDEA データベース（active な版）から検索します。国内（JPN）の製品を優先表示し、
        該当が無い場合はグローバル（GLO 等）を提示します。
      </p>
      {idea.isFactorMissing && <p className="mt-1.5 text-sm text-warning">{SCOPE3_FACTOR_MISSING_MESSAGE}</p>}
    </div>

    {/* 適用する原単位の詳細（製品 / 原単位 / 出典）。参照切れ（詳細が引けない）は孤児と同じ扱いで再選択を促す。 */}
    {!idea.selectedProductId ? (
      <p className="text-sm text-text-muted">IDEA製品を選択すると適用する原単位を表示します。</p>
    ) : idea.isLoadingDetail ? (
      <p className="text-sm text-text-muted">製品情報を取得しています...</p>
    ) : idea.detailError ? (
      <p className="text-sm text-danger">
        {idea.detailError}{' '}
        <button type="button" onClick={idea.retryDetail} className="font-medium text-primary underline">
          再試行
        </button>
      </p>
    ) : !idea.productDetail ? (
      // 参照切れの案内は製品セレクト直下（isFactorMissing）に出しているため、ここでは重複させない。
      null
    ) : (
      <dl data-testid="manual-factor-detail" className="grid grid-cols-1 gap-x-5 gap-y-1.5 text-sm md:grid-cols-3">
        <div>
          <dt className="inline text-text-muted">製品: </dt>
          <dd className="inline font-medium text-text-main">
            {idea.productDetail.productName}（{idea.productDetail.country}）
          </dd>
        </div>
        <div>
          <dt className="inline text-text-muted">原単位: </dt>
          <dd className="inline font-semibold text-text-main">{ideaFactorValueText(idea.productDetail)}</dd>
        </div>
        <div>
          <dt className="inline text-text-muted">出典: </dt>
          <dd className="inline font-medium text-text-main">{ideaSourceText(idea.productDetail)}</dd>
        </div>
      </dl>
    )}
  </>
);
