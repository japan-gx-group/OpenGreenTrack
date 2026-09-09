'use client';

// 拠点の一覧表。読込中のオーバーレイ・0 件表示・行ごとの操作メニュー（⋮）もここで持つ。
// 行クリックで拠点詳細へ遷移し、⋮ から編集/削除モーダルを開く。

import { useState, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { LocationStatusBadge } from './LocationStatusBadge';
import { getLocationTypeLabel, getRegionLabel, type LocationRecord } from '../types';

interface LocationTableProps {
  /** 現在ページに表示する行 */
  rows: LocationRecord[];
  /** 絞り込み後の総件数（0 のときは「見つかりません」を出す） */
  totalCount: number;
  /** 取得・保存のいずれかが進行中 */
  isBusy: boolean;
  /** 初回取得が終わるまでは空状態を出さない */
  hasFetchedOnce: boolean;
  /**
   * 行メニュー（⋮）から編集/削除モーダルを開くと、メニュー項目はモーダル表示と同じコミットで
   * アンマウントされ、その時点で activeElement は body に落ちている。閉じたあとの復帰先を
   * 失わないよう、永続する ⋮ ボタン自体をここに控えて Modal へ渡す。
   */
  menuTriggerRef: RefObject<HTMLButtonElement | null>;
  onResetFilters: () => void;
  onEdit: (row: LocationRecord) => void;
  onDelete: (row: LocationRecord) => void;
}

export const LocationTable = ({
  rows,
  totalCount,
  isBusy,
  hasFetchedOnce,
  menuTriggerRef,
  onResetFilters,
  onEdit,
  onDelete,
}: LocationTableProps) => {
  const router = useRouter();
  // 行ごとの操作メニュー（⋮）の開閉。開いている行の id を保持する。
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <div className="relative min-h-[280px] overflow-x-auto">
      {(isBusy || !hasFetchedOnce) && (
        <div className="absolute inset-0 bg-bg-card/70 flex items-center justify-center z-20 backdrop-blur-[1px]">
          <LoadingIndicator label="拠点データを取得中..." />
        </div>
      )}

      {/* 初回取得が終わるまでは空状態を出さない。 */}
      {!hasFetchedOnce ? null : totalCount === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Building2 size={48} className="text-text-muted mb-3 opacity-50" />
          <p className="font-bold text-text-muted text-lg">条件に合致する拠点が見つかりません</p>
          <button type="button" className="gt-btn mt-4" onClick={onResetFilters}>フィルターをクリア</button>
        </div>
      ) : (
        <table className="gt-table" style={{ minWidth: '820px' }}>
          <thead>
            <tr>
              <th>拠点名</th>
              <th style={{ width: '120px' }}>地域</th>
              <th style={{ width: '130px' }}>拠点種別</th>
              <th style={{ width: '160px' }}>担当者</th>
              <th style={{ width: '110px' }}>稼働状況</th>
              <th style={{ width: '48px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              /* 行クリックで拠点別Scope内訳の詳細画面へ遷移する。
                 行内のボタン類は stopPropagation で遷移と干渉させない。
                 <tr onClick> はキーボードから辿れないため、拠点名セルを Link にして
                 Tab → Enter でも同じ画面へ行けるようにする（行クリックはそのまま残す）。 */
              <tr
                key={row.id}
                className="gt-row-link"
                onClick={() => router.push(`/locations/${row.id}`)}
                title={`「${row.name}」のScope内訳を表示`}
              >
                <td style={{ fontWeight: 600 }}>
                  <Link
                    href={`/locations/${row.id}`}
                    // Link 自身の遷移と行の onClick（router.push）が二重に走らないよう止める
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: 'inherit', textDecoration: 'none' }}
                  >
                    {row.name}
                  </Link>
                </td>
                <td style={{ color: 'var(--color-text-body)' }}>{getRegionLabel(row.region)}</td>
                <td style={{ color: 'var(--color-text-body)' }}>{getLocationTypeLabel(row.type)}</td>
                <td style={{ color: 'var(--color-text-body)' }}>{row.person || '未設定'}</td>
                <td><LocationStatusBadge status={row.status} /></td>
                <td className="gt-num">
                  <div className="relative inline-block text-left">
                    <button
                      type="button"
                      className="text-text-muted hover:text-text-main"
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === row.id}
                      title="操作"
                      onClick={(e) => {
                        e.stopPropagation();
                        menuTriggerRef.current = e.currentTarget;
                        setOpenMenuId(openMenuId === row.id ? null : row.id);
                      }}
                    >
                      <MoreVertical size={16}/>
                    </button>

                    {openMenuId === row.id && (
                      <>
                        {/* メニュー外クリックで閉じる。行遷移を防ぐため stopPropagation する。 */}
                        <div
                          className="fixed inset-0 z-40"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); }}
                        />
                        <div
                          role="menu"
                          className="absolute right-0 mt-1 w-32 bg-bg-card border border-border rounded-md shadow-lg py-1 z-50 animate-dropdown-in"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="w-full text-left px-3 py-2 text-xs text-text-main hover:bg-bg-main transition-colors flex items-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                              onEdit(row);
                            }}
                          >
                            <Pencil size={14} /> 編集
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="w-full text-left px-3 py-2 text-xs text-danger hover:bg-bg-main transition-colors flex items-center gap-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(null);
                              onDelete(row);
                            }}
                          >
                            <Trash2 size={14} /> 削除
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
