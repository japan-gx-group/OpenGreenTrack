'use client';

// Scope3 カテゴリ別の算定方法管理パネル（docs/idea-scope3-spec.md §5.2）。
// カテゴリ1〜15ごとに算定方法バッジ（直接入力 / 積上げ）・方法切替・direct 値の編集導線を
// 提供し、積上げ（calculated）カテゴリは製品別内訳のドリルダウンを展開表示する。
// 方式切替・値の保存は親（ScopeAnalysis）のハンドラ経由で行い、成功後に親がデータを
// 再取得する（切替直後に scope3Total が更新される。集計は Route Handler 経由の
// refresh_dashboard_aggregates が担う）。

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/Modal.client';
import {
  getScope3CategoryDrilldown,
  type Scope3CategoryDrilldown,
  type Scope3Method,
  type Scope3MethodCategoryItem,
} from '../services/scopeAnalysisService';

const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });

const formatEmissions = (value: number | null): string =>
  value === null ? '—' : numberFormatter.format(value);

const DECIMAL_PATTERN = /^\d*(?:\.\d*)?$/;

interface Scope3MethodPanelProps {
  items: Scope3MethodCategoryItem[];
  /** 方式・直接入力値の書き込みと再集計・ドリルダウン取得に使う年度ID */
  fiscalYearId: string;
  /** 方式切替（upsert ＋ 再集計 ＋ 再取得は親が行う）。 */
  onSwitchMethod: (categoryId: number, method: Scope3Method) => Promise<void>;
  /** direct 値の保存（upsert ＋ 再集計 ＋ 再取得は親が行う）。 */
  onSaveDirect: (categoryId: number, emissions: number, dataSourceNote: string) => Promise<void>;
}

type DrilldownState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; data: Scope3CategoryDrilldown };

export const Scope3MethodPanel: React.FC<Scope3MethodPanelProps> = ({
  items,
  fiscalYearId,
  onSwitchMethod,
  onSaveDirect,
}) => {
  // 方式切替の実行中カテゴリ（ボタンの二重押下防止）。
  const [switchingCategoryId, setSwitchingCategoryId] = useState<number | null>(null);
  // direct 値の編集モーダル。
  const [editingItem, setEditingItem] = useState<Scope3MethodCategoryItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingDirect, setIsSavingDirect] = useState(false);
  // ドリルダウンの展開状態とカテゴリ別の取得結果キャッシュ。
  // キャッシュのキーはカテゴリIDのみのため、年度が変わったら破棄が必要。
  // 親（ScopeAnalysis）が key={fiscalYearId} で本パネルを再マウントすることで担保している。
  const [expandedCategoryId, setExpandedCategoryId] = useState<number | null>(null);
  const [drilldowns, setDrilldowns] = useState<Record<number, DrilldownState>>({});

  const handleSwitch = async (item: Scope3MethodCategoryItem) => {
    if (switchingCategoryId !== null) return;
    const nextMethod: Scope3Method = item.method === 'direct' ? 'calculated' : 'direct';
    setSwitchingCategoryId(item.categoryId);
    try {
      await onSwitchMethod(item.categoryId, nextMethod);
    } finally {
      setSwitchingCategoryId(null);
    }
  };

  const openEditModal = (item: Scope3MethodCategoryItem) => {
    setEditingItem(item);
    setEditValue(item.directEmissions !== null ? String(item.directEmissions) : '');
    setEditNote(item.directDataSourceNote ?? '');
    setEditError(null);
  };

  const closeEditModal = () => {
    if (isSavingDirect) return;
    setEditingItem(null);
  };

  const handleSaveDirect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingItem || isSavingDirect) return;

    const parsed = Number(editValue);
    if (editValue.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      setEditError('排出量には0以上の数値を入力してください');
      return;
    }

    setIsSavingDirect(true);
    setEditError(null);
    try {
      await onSaveDirect(editingItem.categoryId, parsed, editNote);
      setEditingItem(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : '保存に失敗しました');
    } finally {
      setIsSavingDirect(false);
    }
  };

  const toggleDrilldown = (categoryId: number) => {
    if (expandedCategoryId === categoryId) {
      setExpandedCategoryId(null);
      return;
    }
    setExpandedCategoryId(categoryId);

    // 取得済み（loaded）はキャッシュを使い、未取得・失敗時のみ取り直す。
    const cached = drilldowns[categoryId];
    if (cached && cached.status === 'loaded') return;

    setDrilldowns(prev => ({ ...prev, [categoryId]: { status: 'loading' } }));
    getScope3CategoryDrilldown(fiscalYearId, categoryId)
      .then(data => {
        setDrilldowns(prev => ({ ...prev, [categoryId]: { status: 'loaded', data } }));
      })
      .catch(error => {
        setDrilldowns(prev => ({
          ...prev,
          [categoryId]: {
            status: 'error',
            message: error instanceof Error ? error.message : '製品別内訳の取得に失敗しました',
          },
        }));
      });
  };

  const renderDrilldown = (categoryId: number) => {
    const state = drilldowns[categoryId];
    if (!state || state.status === 'loading') {
      return (
        <div className="flex items-center gap-2 py-3 text-sm text-text-muted">
          <Loader2 size={14} className="animate-spin" /> 製品別内訳を読み込んでいます...
        </div>
      );
    }
    if (state.status === 'error') {
      return <div className="py-3 text-sm text-danger">{state.message}</div>;
    }
    if (state.data.products.length === 0) {
      return (
        <div className="py-3 text-sm text-text-muted">
          このカテゴリの積上げ算定結果はまだありません。データ入力画面の「データ入力」タブで、カテゴリの「IDEA 原単位（Scope 3 積上げ・カテゴリ1〜15）」から該当カテゴリを選んで登録し、算定を実行してください。
        </div>
      );
    }
    return (
      <div className="overflow-x-auto py-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-light text-left text-[10.5px] uppercase tracking-[0.06em] text-text-label">
              <th className="px-2 py-1.5 font-medium">製品</th>
              <th className="px-2 py-1.5 text-right font-medium">活動量</th>
              <th className="px-2 py-1.5 text-right font-medium">排出量 (t-CO₂e)</th>
              <th className="px-2 py-1.5 text-right font-medium">構成比</th>
            </tr>
          </thead>
          <tbody>
            {state.data.products.map(product => (
              <tr key={product.key} className="border-b border-border-light last:border-b-0">
                <td className="px-2 py-1.5 text-text-heading">{product.productName}</td>
                <td className="px-2 py-1.5 text-right text-text-main">
                  {product.totalAmount !== null && product.unit
                    ? `${numberFormatter.format(product.totalAmount)} ${product.unit}`
                    : '—'}
                </td>
                <td className="px-2 py-1.5 text-right font-medium text-text-heading">
                  {numberFormatter.format(product.totalEmissions)}
                </td>
                <td className="px-2 py-1.5 text-right text-text-main">{product.percentage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-light text-left text-[10.5px] uppercase tracking-[0.06em] text-text-label">
            <th className="px-2 py-2 font-medium">カテゴリ</th>
            <th className="px-2 py-2 font-medium">算定方法</th>
            <th className="px-2 py-2 text-right font-medium">直接入力値 (t-CO₂e)</th>
            <th className="px-2 py-2 text-right font-medium">積上げ算定値 (t-CO₂e)</th>
            <th className="px-2 py-2 text-right font-medium">採用値 (t-CO₂e)</th>
            <th className="px-2 py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const isCalculated = item.method === 'calculated';
            const isSwitching = switchingCategoryId === item.categoryId;
            const isExpanded = expandedCategoryId === item.categoryId;
            return (
              <React.Fragment key={item.categoryId}>
                <tr className="border-b border-border-light align-middle">
                  <td className="px-2 py-2.5 text-text-heading">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-left"
                      onClick={() => toggleDrilldown(item.categoryId)}
                      aria-expanded={isExpanded}
                      aria-label={`カテゴリ${item.categoryId}の製品別内訳を${isExpanded ? '閉じる' : '開く'}`}
                      // 「カテゴリ名をクリックすると製品別内訳を表示」の操作ヒントを説明文から
                      // ここへ移し、ホバー時のツールチップとして出す（展開アイコンと併せて導線を示す）。
                      title={`クリックで積上げ算定の製品別内訳を${isExpanded ? '閉じる' : '表示'}`}
                    >
                      {isExpanded ? (
                        <ChevronDown size={14} className="shrink-0 text-text-label" />
                      ) : (
                        <ChevronRight size={14} className="shrink-0 text-text-label" />
                      )}
                      <span>
                        <span className="mr-1.5 font-serif font-semibold text-text-label">
                          {String(item.categoryId).padStart(2, '0')}
                        </span>
                        {item.name}
                      </span>
                    </button>
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge variant={isCalculated ? 'success' : 'info'}>
                      {isCalculated ? '積上げ' : '直接入力'}
                    </Badge>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={isCalculated ? 'text-text-muted' : 'font-medium text-text-heading'}>
                      {formatEmissions(item.directEmissions)}
                    </span>
                    {/* calculated 採用中でも直接入力値は削除せず保持する（切替の可逆性）。 */}
                    {isCalculated && item.directEmissions !== null && (
                      <div className="mt-0.5 text-[10.5px] text-text-label">
                        未採用（積上げ算定を採用中）
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span className={isCalculated ? 'font-medium text-text-heading' : 'text-text-muted'}>
                      {numberFormatter.format(item.calculatedEmissions)}
                    </span>
                    {!isCalculated && item.calculatedEmissions > 0 && (
                      <div className="mt-0.5 text-[10.5px] text-text-label">
                        未採用（直接入力を採用中）
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right font-serif font-semibold text-text-heading">
                    {numberFormatter.format(item.adoptedEmissions)}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="gt-btn h-auto gap-1 px-2 py-1 text-xs"
                        onClick={() => openEditModal(item)}
                      >
                        <Pencil size={12} /> 直接入力値
                      </button>
                      <button
                        type="button"
                        className="gt-btn h-auto gap-1 px-2 py-1 text-xs"
                        onClick={() => handleSwitch(item)}
                        disabled={switchingCategoryId !== null}
                      >
                        {isSwitching && <Loader2 size={12} className="animate-spin" />}
                        {isCalculated ? '直接入力に切替' : '積上げに切替'}
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-border-light">
                    <td colSpan={6} className="bg-bg-subtle px-6 py-1">
                      {renderDrilldown(item.categoryId)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* direct 方式の値の編集モーダル（scope3_category_emissions への upsert 導線）。 */}
      <Modal
        isOpen={editingItem !== null}
        onClose={closeEditModal}
        title={
          editingItem
            ? `カテゴリ${editingItem.categoryId}: ${editingItem.name} の直接入力値`
            : '直接入力値の編集'
        }
        size="md"
      >
        <form onSubmit={handleSaveDirect} className="flex flex-col gap-4">
          {editingItem?.method === 'calculated' && (
            <div className="rounded-md border border-border-light bg-bg-subtle px-3 py-2 text-xs text-text-muted">
              このカテゴリは積上げ算定を採用中のため、保存した直接入力値は「未採用」として保持されます
              （直接入力へ切り替えると採用されます）。
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-label">排出量（t-CO₂e）</span>
            <input
              type="text"
              inputMode="decimal"
              className="gt-field"
              value={editValue}
              onChange={event => {
                const next = event.target.value;
                if (next === '' || DECIMAL_PATTERN.test(next)) {
                  setEditValue(next);
                }
              }}
              placeholder="例: 1250.5"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-label">データソースメモ（任意）</span>
            <input
              type="text"
              className="gt-field"
              value={editNote}
              onChange={event => setEditNote(event.target.value)}
              placeholder="例: 産業連関表ベースの推計値"
              maxLength={500}
            />
          </label>
          {editError && <div className="text-sm text-danger">{editError}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="gt-btn"
              onClick={closeEditModal}
              disabled={isSavingDirect}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="gt-btn-primary flex items-center gap-2"
              disabled={isSavingDirect}
            >
              {isSavingDirect && <Loader2 size={14} className="animate-spin" />}
              保存する
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
