'use client';

// 供給事業者別係数（電気・都市ガス・熱）の選択 UI。
// 計算方法（基礎/調整後）→ 供給事業者 → メニュー の順に選ぶと係数が確定する。
// 事業者別係数は自動解決の対象外のため、ここで選択した係数を明示指定として保存する。
// 事業者未選択のままなら従来どおり自動解決（代替値が適用される）。

import React from 'react';
import { SearchableSelect } from '@/components/ui/SearchableSelect.client';
import type { FactorTypeChoice } from '../services/entryCategory';
import type { ProviderSelection } from '../services/entryFactorSelection';
import type { CandidateFactorRow } from '../services/factorSelectionService';
import type { ProviderOption } from '../services/providerOptions';
import { EntryField } from './EntryFormPrimitives';

export interface ProviderFactorFieldsProps {
  providerOptions: ProviderOption[];
  menuOptions: CandidateFactorRow[];
  selection: ProviderSelection;
  providerFactor: CandidateFactorRow | null;
  /** 事業者リストの取得中。取得完了前の操作で編集時の復元が飛ばないよう、計算方法・事業者の両方を disabled にする */
  isLoadingProviders: boolean;
  /** 事業者リストの取得に失敗した（代替値では計算できるが、契約先の係数は選べない） */
  providerLoadFailed: boolean;
  onRetryProviders: () => void;
  onFactorTypeChange: (value: FactorTypeChoice) => void;
  onProviderChange: (value: string | null) => void;
  onMenuChange: (value: string | null) => void;
}

export const ProviderFactorFields = ({
  providerOptions,
  menuOptions,
  selection,
  providerFactor,
  isLoadingProviders,
  providerLoadFailed,
  onRetryProviders,
  onFactorTypeChange,
  onProviderChange,
  onMenuChange,
}: ProviderFactorFieldsProps) => (
  <div className="flex flex-col gap-2">
    <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-3">
      <EntryField htmlFor="manual-factor-type-select" label="計算方法">
        <select
          id="manual-factor-type-select"
          value={selection.factorType}
          onChange={(event) => onFactorTypeChange(event.target.value as FactorTypeChoice)}
          disabled={isLoadingProviders}
          className="gt-field"
        >
          <option value="adjusted">調整後排出係数</option>
          <option value="basic">基礎排出係数</option>
        </select>
      </EntryField>

      {/* 「未選択なら代替値」はセクション冒頭の説明文と重複するため、ラベルには載せない。 */}
      <EntryField
        htmlFor="manual-provider-select"
        label="供給事業者"
        className={menuOptions.length > 1 ? '' : 'md:col-span-2'}
      >
        <SearchableSelect
          id="manual-provider-select"
          ariaDescribedBy="manual-provider-select-help"
          options={providerOptions}
          value={selection.providerName}
          onChange={onProviderChange}
          placeholder={isLoadingProviders ? '事業者リストを取得中...' : '事業者名またはコードで検索して選択'}
          disabled={isLoadingProviders}
        />
      </EntryField>

      {menuOptions.length > 1 && (
        <EntryField htmlFor="manual-menu-select" label="メニュー / 供給区域">
          <select
            id="manual-menu-select"
            value={providerFactor?.menuName ?? ''}
            onChange={(event) => onMenuChange(event.target.value || null)}
            className="gt-field"
          >
            <option value="">選択してください</option>
            {menuOptions.map((option) => (
              <option key={option.id} value={option.menuName ?? ''}>
                {option.menuName ?? '（メニューなし）'}
              </option>
            ))}
          </select>
        </EntryField>
      )}
    </div>

    {/* 1列（画面幅の 1/3）に押し込めると3行に折り返して読みにくいため、セレクト行の下に全幅で置く。 */}
    <p id="manual-provider-select-help" className="text-xs text-text-muted">
      事業者コードは、環境省・経済産業省が公表する「温室効果ガス排出量算定・報告・公表制度」の事業者別排出係数一覧に記載された登録番号です。
    </p>

    {/* 取得失敗は警告扱いにせず代替値で入力を続けられるが、「事業者が未登録」と誤認しないよう再試行の導線を出す。 */}
    {providerLoadFailed && (
      <p className="text-sm text-warning">
        事業者リストを取得できませんでした。代替値で計算するか、
        <button type="button" onClick={onRetryProviders} className="font-medium text-primary underline">
          再試行
        </button>
        してください。
      </p>
    )}
  </div>
);
