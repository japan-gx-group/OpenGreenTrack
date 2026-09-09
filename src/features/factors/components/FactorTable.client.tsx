'use client';

// 排出係数の一覧表。読込中のオーバーレイと 0 件表示もここで持つ。
// 行クリックで出典・算定式のモーダルを開き、カスタム係数の行だけ編集・削除ボタンを出す。

import { Database, Edit3, X } from 'lucide-react';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import type { EmissionFactor } from '../services/factorService';
import {
  FACTOR_GROUP_ENERGY_FIELD_LABELS,
  FACTOR_GROUP_LABELS,
  type FactorGroup,
} from '../utils/factorGroups';

interface FactorTableProps {
  /** 現在ページに表示する行 */
  rows: EmissionFactor[];
  /** 絞り込み後の総件数（0 のときは「見つかりません」を出す） */
  totalCount: number;
  activeGroup: FactorGroup;
  /** 取得・保存・取込のいずれかが進行中 */
  isBusy: boolean;
  onResetFilters: () => void;
  onSelect: (factor: EmissionFactor) => void;
  onEdit: (factor: EmissionFactor) => void;
  onDelete: (factor: EmissionFactor) => void;
}

export const FactorTable = ({
  rows,
  totalCount,
  activeGroup,
  isBusy,
  onResetFilters,
  onSelect,
  onEdit,
  onDelete,
}: FactorTableProps) => (
  <div style={{ position: 'relative', minHeight: '120px', overflowX: 'auto', marginTop: '1rem' }}>
    {isBusy && (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          // カード地（--bg-card）を70%重ねたローディングスクリーン。テーマ色に追従させる。
          backgroundColor: 'color-mix(in srgb, var(--color-bg-card) 70%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 20,
          backdropFilter: 'blur(1px)',
          transition: 'all 0.2s'
        }}
      >
        <LoadingIndicator label="クエリを実行中..." />
      </div>
    )}

    {totalCount === 0 ? (
      <div className="flex-col items-center justify-center py-12 text-center">
        <Database size={48} className="text-text-muted mb-3" style={{ opacity: 0.5 }} />
        <p className="font-bold text-text-muted text-lg">該当する排出係数が見つかりません</p>
        <p className="text-sm text-text-muted mt-1">
          「{FACTOR_GROUP_LABELS[activeGroup]}」に、選択されたフィルター条件または検索キーワードに合致するデータがありません。
        </p>
        <button type="button" className="gt-btn mt-4" onClick={onResetFilters}>フィルターをクリア</button>
      </div>
    ) : (
      <table className="gt-table table-fixed min-w-[1080px] break-words">
        {/* ページを移動しても列幅が変わらないよう table-fixed + colgroup で固定する。
            自動レイアウトだとページごとの本文の長さで見出しの折り返し位置まで変わってしまう。
            最小幅を下回る画面では親の overflowX でスクロールさせる。 */}
        <colgroup>
          <col className="w-[21%]" />
          <col className="w-[10%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[7%]" />
          <col className="w-[7%]" />
          <col className="w-[15%]" />
          <col className="w-[10%]" />
          <col className="w-[6%]" />
          <col className="w-[6%]" />
        </colgroup>
        <thead>
          <tr>
            <th>係数名</th>
            <th>{FACTOR_GROUP_ENERGY_FIELD_LABELS[activeGroup]}</th>
            <th>適用範囲</th>
            <th className="gt-num">係数値</th>
            <th>単位</th>
            <th>適用年度</th>
            <th>事業者 / メニュー</th>
            <th>データソース</th>
            <th>種別</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            /* 行クリックで出典・算定式のモーダルを開く（入力履歴・拠点一覧と同じ操作）。
               行内のボタンは stopPropagation でモーダルと干渉させない。 */
            <tr
              key={row.id}
              onClick={() => onSelect(row)}
              title="クリックして出典・算定式を表示"
              /* 行の高さを揃える。h-[72px] は表では最小値なので、
                 あふれる可能性のあるセルを truncate / line-clamp-2 で最大2行に抑えて上限も固定する。
                 省略された全文は title 属性で参照できる。 */
              className="h-[72px] gt-row-link"
            >
              <td title={row.name}>
                <div className="flex items-center gap-2">
                  {row.isCustom ? (
                    <span className="gt-pill gt-pill-sm gt-pill-info shrink-0" style={{ fontSize: '10.5px', letterSpacing: '0.04em' }}>CUSTOM</span>
                  ) : (
                    <span className="gt-pill gt-pill-sm gt-pill-good shrink-0" style={{ fontSize: '10.5px', letterSpacing: '0.04em' }}>STD</span>
                  )}
                  <span className="min-w-0 line-clamp-2">{row.name}</span>
                </div>
              </td>
              <td className="text-text-body" title={row.energyType}>
                <div className="line-clamp-2">{row.energyType}</div>
              </td>
              <td>
                <span className="gt-pill gt-pill-sm gt-pill-accent">{row.scope}</span>
              </td>
              <td className="gt-num" style={{ fontWeight: 600 }}>
                <div className="truncate">{row.factorValue.toFixed(6)}</div>
              </td>
              <td className="text-text-subtle" title={row.unit} style={{ fontSize: '12px' }}>
                <div className="truncate">{row.unit}</div>
              </td>
              <td className="font-semibold">
                <div className="truncate">{row.applicableYear}</div>
              </td>
              <td
                className="text-text-body"
                title={[row.providerName, row.menuName].filter(Boolean).join(' / ')}
              >
                {row.providerName ? (
                  <>
                    <span className="block truncate">{row.providerName}</span>
                    {row.menuName && <span className="block truncate text-xs">{row.menuName}</span>}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="text-text-body" title={row.source}>
                <div className="line-clamp-2">{row.source}</div>
              </td>
              <td>
                <span className={`text-xs ${row.isCustom ? 'text-info font-medium' : 'text-text-muted'}`}>
                  {row.isCustom ? 'カスタム' : '標準'}
                </span>
              </td>
              <td className="py-4 text-right whitespace-nowrap">
                {row.isCustom && (
                  <>
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-main mr-2"
                      onClick={(event) => { event.stopPropagation(); onEdit(row); }}
                      title="編集"
                    >
                      <Edit3 size={16}/>
                    </button>
                    <button
                      type="button"
                      className="text-text-muted hover:text-danger"
                      onClick={(event) => { event.stopPropagation(); onDelete(row); }}
                      title="削除"
                    >
                      <X size={16}/>
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);
