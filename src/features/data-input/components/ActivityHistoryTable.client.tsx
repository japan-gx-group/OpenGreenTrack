'use client';

// 入力履歴の一覧表。履歴 0 件と絞り込み 0 件の空状態もここで持つ。
// 行クリックで編集モーダルを開く（編集できるのは元レコードを保持する行だけ）。

import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { HistoryItem } from '../hooks/useActivityHistory';
import type { SavedManualActivityRecord } from '../types';

interface ActivityHistoryTableProps {
  /** 現在ページに表示する行 */
  rows: HistoryItem[];
  /** 登録済み件数（絞り込み前）。0 なら「まだありません」 */
  totalCount: number;
  /** 絞り込み後の件数。登録はあるのに 0 なら「見つかりません」 */
  filteredCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onSelect: (record: SavedManualActivityRecord) => void;
}

export const ActivityHistoryTable = ({
  rows,
  totalCount,
  filteredCount,
  hasActiveFilters,
  onClearFilters,
  onSelect,
}: ActivityHistoryTableProps) => (
  <div style={{ overflowX: 'auto' }}>
    <table className="gt-table" style={{ minWidth: '860px' }}>
      <thead>
        <tr>
          <th style={{ width: '150px' }}>拠点名</th>
          {/* エネルギー・燃料と Scope 3 活動が同じ表に並ぶため「カテゴリ」で揃える。
              入力フォームの項目名（ActivityEntryForm の「カテゴリ」）とも一致する。 */}
          <th>カテゴリ</th>
          <th className="gt-num" style={{ width: '130px' }}>使用量</th>
          <th style={{ width: '70px' }}>単位</th>
          <th className="gt-num" style={{ width: '140px' }}>排出量 (t-CO2e)</th>
          <th style={{ width: '110px' }}>対象期間</th>
          <th style={{ width: '100px' }}>ステータス</th>
          <th style={{ width: '150px' }}>登録日時</th>
        </tr>
      </thead>
      <tbody>
        {totalCount === 0 && (
          <tr>
            <td className="gt-table-empty" colSpan={8}>
              入力履歴はまだありません。
            </td>
          </tr>
        )}
        {totalCount > 0 && filteredCount === 0 && (
          <tr>
            <td colSpan={8} className="py-10">
              <div className="flex flex-col items-center justify-center gap-3 text-center">
                <Search size={36} aria-hidden="true" className="text-text-muted opacity-50" />
                <p className="font-semibold text-text-muted">条件に一致する入力履歴が見つかりません</p>
                {hasActiveFilters && (
                  <button type="button" className="gt-btn" onClick={onClearFilters}>
                    絞り込みをクリア
                  </button>
                )}
              </div>
            </td>
          </tr>
        )}
        {rows.map((row) => {
          // 編集できるのは、サーバ取得済みで元レコードを保持する行のみ。
          const editableRecord = row.record;
          return (
          <tr
            key={row.id}
            onClick={editableRecord ? () => onSelect(editableRecord) : undefined}
            title={editableRecord ? 'クリックして編集' : undefined}
            className={`${row.isNew ? 'new-table-row' : ''} ${editableRecord ? 'gt-row-link' : ''}`}
          >
            <td>
              <div className="flex items-center gap-2" translate="no">
                {row.isNew && (
                  <span
                    className="bg-primary/10 text-primary"
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}
                  >
                    NEW
                  </span>
                )}
                {row.name}
              </div>
            </td>
            <td style={{ color: 'var(--color-text-body)' }}>
              {row.energy}
              {/* Scope3積上げ行はカテゴリ・IDEA製品名を補足表示する。 */}
              {row.scope3CategoryLabel && (
                <div className="mt-0.5 text-xs text-text-subtle">{row.scope3CategoryLabel}</div>
              )}
              {row.categoryValue === 'scope3_activity' && (
                <div className="mt-0.5 text-xs text-text-subtle">
                  {row.ideaProductName ?? '（製品の参照切れ・再選択が必要）'}
                </div>
              )}
            </td>
            <td className="gt-num" style={{ fontWeight: 600 }}>{row.amount}</td>
            <td style={{ color: 'var(--color-text-subtle)', fontSize: '12px' }}>{row.unit}</td>
            <td
              className="gt-num"
              style={{
                fontSize: '14px',
                fontWeight: row.emissions === null || row.emissions === undefined ? 400 : 600,
                color:
                  row.emissions === null || row.emissions === undefined
                    ? 'var(--color-text-muted)'
                    : 'var(--color-text-heading)',
              }}
            >
              {/* 表示とキーワード検索で値がずれないよう、同じ emissionsText を使う。 */}
              {row.emissionsText}
            </td>
            <td style={{ color: 'var(--color-text-muted)' }}>{row.period}</td>
            <td>
              <Badge variant="success">{row.status}</Badge>
            </td>
            <td style={{ color: 'var(--color-text-muted)', fontSize: '12.5px' }}>{row.date}</td>
          </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
