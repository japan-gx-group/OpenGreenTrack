'use client';

// 拠点の一覧表。読込中のオーバーレイ・0 件表示・行ごとの操作メニュー（⋮）もここで持つ。
// 行クリックで拠点詳細へ遷移し、⋮ から編集/削除モーダルを開く。

import { useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  /** 一覧を取得できず、出せる拠点が 1 件も無い（「見つかりません」ではなく、取得の失敗と再試行を出す） */
  loadFailed: boolean;
  /** 一覧を取り直す（「再試行」） */
  onRetry: () => void;
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
  loadFailed,
  onRetry,
  menuTriggerRef,
  onResetFilters,
  onEdit,
  onDelete,
}: LocationTableProps) => {
  const router = useRouter();
  // 行ごとの操作メニュー（⋮）の開閉。開いている行の id を保持する。
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 行ごとの ⋮ ボタン。キーボード（Enter / Space / ↓）で開いたときは click が発火しないため、
  // 開いた時点で menuTriggerRef へ控えるのに使う。
  const triggerEls = useRef(new Map<string, HTMLButtonElement>());
  // メニュー項目を選んだ（= 編集/削除モーダルを開く）ことの印。閉じた後のフォーカス復帰を
  // Radix の既定（⋮ へ戻す）ではなく Modal 側（returnFocusRef）に任せるために使う。
  const actionChosenRef = useRef(false);

  return (
    <div className="relative min-h-[280px] overflow-x-auto">
      {(isBusy || !hasFetchedOnce) && (
        <div className="absolute inset-0 bg-bg-card/70 flex items-center justify-center z-20 backdrop-blur-[1px]">
          <LoadingIndicator label="拠点データを取得中..." />
        </div>
      )}

      {/* 初回取得が終わるまでは空状態を出さない。 */}
      {!hasFetchedOnce ? null : loadFailed ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Building2 size={48} className="text-text-muted mb-3 opacity-50" />
          <p className="font-bold text-text-muted text-lg">拠点を取得できませんでした</p>
          <p className="text-sm text-text-muted mt-2">通信状態を確かめて、もう一度お試しください。</p>
          <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
            再試行
          </Button>
        </div>
      ) : totalCount === 0 ? (
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
                onClick={(e) => {
                  const href = `/locations/${row.id}`;
                  // 修飾キー付きクリックは現在タブを動かさず新規タブで開く（名前セルのリンクと同じ挙動）
                  if (e.metaKey || e.ctrlKey || e.shiftKey) {
                    window.open(href, '_blank', 'noopener');
                    return;
                  }
                  router.push(href);
                }}
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
                  {/* Radix の DropdownMenu は WAI-ARIA の menu パターンを備える:
                      Escape で閉じて ⋮ へフォーカスを戻す / 開いたら先頭の項目へフォーカス / ↑↓ で移動。
                      メニューは Portal に描かれるが、React のイベントは親（<tr onClick>）へ伝わるため、
                      項目クリックで行遷移が起きないよう Content で止める。 */}
                  <DropdownMenu
                    // 非モーダル: 透明な背景が次のクリックを吸い込まず、別の行の ⋮ は 1 クリックで開ける
                    modal={false}
                    open={openMenuId === row.id}
                    onOpenChange={(open) => {
                      if (open) {
                        menuTriggerRef.current = triggerEls.current.get(row.id) ?? null;
                      }
                      // 別の行のメニューが開いた後に、閉じる側の通知が遅れて届いても上書きしない
                      setOpenMenuId((current) => (open ? row.id : current === row.id ? null : current));
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) triggerEls.current.set(row.id, el);
                          else triggerEls.current.delete(row.id);
                        }}
                        className="text-text-muted hover:text-text-main"
                        title="操作"
                        // 行クリック（拠点詳細への遷移）と干渉させない
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-32"
                      onClick={(e) => e.stopPropagation()}
                      onCloseAutoFocus={(e) => {
                        // 項目を選んだ場合はモーダルが開いてフォーカスを持つので、⋮ へは戻さない。
                        // Escape・外側クリックで閉じた場合だけ、Radix の既定で ⋮ へ戻す。
                        if (actionChosenRef.current) {
                          actionChosenRef.current = false;
                          e.preventDefault();
                        }
                      }}
                    >
                      <DropdownMenuItem
                        className="text-xs"
                        onSelect={() => {
                          actionChosenRef.current = true;
                          onEdit(row);
                        }}
                      >
                        <Pencil size={14} /> 編集
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="text-xs"
                        onSelect={() => {
                          actionChosenRef.current = true;
                          onDelete(row);
                        }}
                      >
                        <Trash2 size={14} /> 削除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
