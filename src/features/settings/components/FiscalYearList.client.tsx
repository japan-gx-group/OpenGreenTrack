'use client';

// 会計年度（fiscal_years）の管理 UI（年度の追加/削除）。
// ロールによる出し分けは行わず、認証済みメンバー全員が操作できる（ロール判定は無効）。
// 一覧・追加・削除はすべて Server Action（service_role）経由で行い、対象は呼び出し元の
// 組織の年度に限定される（src/features/settings/services/fiscalYears.ts）。
// fiscal_years は組織別マスタのため、ここでの操作は自組織の年度セレクタに影響する（反映は再読込後）。
// 削除は「参照データ（算定・目標・供給者データ等）が無い年度だけ」に限定する（cascade による
// 破壊的削除を防ぐガード。判定・実削除ともサーバ側で行う）。

import React, { useCallback, useEffect, useState } from 'react';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal.client';
import { Plus, Loader2, CalendarDays, Trash2 } from 'lucide-react';
import {
  addFiscalYear,
  deleteFiscalYear,
  listFiscalYearsWithUsage,
  type FiscalYearUsage,
} from '@/features/settings/services/fiscalYears';
import {
  deriveFiscalYearPeriod,
  formatFiscalYearPeriod,
  isCurrentFiscalYear,
  normalizeFiscalYearStartMonth,
} from '@/lib/fiscal-year/fiscalYearPeriod';

export const FiscalYearList = ({
  showToast,
  refreshKey = 0,
}: {
  showToast: (message: string, type: 'success' | 'error') => void;
  refreshKey?: number;
}) => {
  const [years, setYears] = useState<FiscalYearUsage[]>([]);
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(4);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [startYearInput, setStartYearInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [yearToDelete, setYearToDelete] = useState<FiscalYearUsage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { refresh: refreshFiscalYears } = useFiscalYear();

  // fetch 結果を state へ反映する（effect 本体での同期 setState を避けるため、取得と反映を分離し
  // .then(applyYears) の形で呼ぶ。MemberList と同じ react-hooks/set-state-in-effect 対応）。
  const applyYears = useCallback((result: Awaited<ReturnType<typeof listFiscalYearsWithUsage>>) => {
    if (result.ok) {
      setLoadError('');
      setFiscalYearStartMonth(result.data.fiscalYearStartMonth);
      setYears(result.data.years);
    } else {
      setLoadError(result.error);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    listFiscalYearsWithUsage().then(applyYears);
  }, [applyYears, refreshKey]);

  // 入力中の開始年から、会社情報の期首月に沿った年度期間をプレビューする。
  const parsedYear = /^\d{4}$/.test(startYearInput) ? Number(startYearInput) : null;
  const preview = parsedYear ? deriveFiscalYearPeriod(parsedYear, fiscalYearStartMonth) : null;
  const normalizedStartMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);

  const handleAdd = async () => {
    if (isAdding) return;
    if (parsedYear === null) {
      showToast('年度が始まる年を西暦4桁で入力してください（例: 2026）', 'error');
      return;
    }

    setIsAdding(true);
    try {
      const result = await addFiscalYear({ startYear: parsedYear });
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      showToast(
        `${result.data.label}を追加しました（${formatFiscalYearPeriod(result.data.startDate, result.data.endDate)}）`,
        'success',
      );
      setStartYearInput('');
      applyYears(await listFiscalYearsWithUsage());
      // ルート直下の FiscalYearProvider は client 遷移で再マウントされないため、明示的に取り直して
      // ダッシュボード等の年度選択肢へ即時反映する。
      await refreshFiscalYears();
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      setIsAdding(false);
    }
  };

  const confirmDelete = async () => {
    if (!yearToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      const result = await deleteFiscalYear(yearToDelete.id);
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      showToast(`${yearToDelete.label}を削除しました`, 'success');
      setYearToDelete(null);
      applyYears(await listFiscalYearsWithUsage());
      await refreshFiscalYears();
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">
          <CalendarDays size={18} className="text-primary" />
          算定年度の管理
        </h2>
      </div>
      <p className="text-xs text-text-muted">
        年度は会社全体で共通の設定です。追加した年度は、社内のメンバー全員が各画面の年度の選択肢として
        選べるようになります（各自が画面を再読み込みすると反映されます）。
        新しく追加する年度の期間は、会社情報の「算定年度の開始月」（現在: {normalizedStartMonth}月）をもとに決まります。
        算定年度の開始月が未設定の場合は4月開始になります。算定結果や目標などが登録されている年度は、
        誤ってデータごと消してしまわないよう削除できません。
        なお、算定年度の開始月を変更しても、登録済みの年度の期間は自動では変わりません。
      </p>
      <hr className="border-border" />

      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-border text-text-muted text-sm">
            <th className="font-semibold px-4 py-2">年度</th>
            <th className="font-semibold px-4 py-2">期間</th>
            <th className="font-semibold px-4 py-2">状態</th>
            <th className="font-semibold px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year.id} className="border-b border-border-light">
              <td className="px-4 py-3 font-medium text-text-main">{year.label}</td>
              <td className="px-4 py-3 text-sm text-text-muted">
                {formatFiscalYearPeriod(year.startDate, year.endDate)}
              </td>
              <td className="px-4 py-3 text-xs">
                {/* 「現在」は今日が期間内かで導出する（DB フラグは無い） */}
                {isCurrentFiscalYear(year) ? (
                  <span className="text-primary font-semibold">現在</span>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                {/* 参照データがある年度は削除不可（cascade でデータごと消えるのを防ぐ） */}
                <button
                  type="button"
                  onClick={() => setYearToDelete(year)}
                  disabled={year.hasData}
                  title={
                    year.hasData
                      ? 'この年度の算定結果や目標などが登録されているため削除できません'
                      : 'この年度を削除'
                  }
                  className="text-danger hover:brightness-75 disabled:text-text-subtle disabled:cursor-not-allowed p-1"
                >
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
          {isLoading && (
            <tr>
              <td colSpan={4} className="text-text-muted text-sm px-4 py-8 text-center">
                <Loader2 size={16} className="animate-spin inline-block mr-2" />
                読み込んでいます...
              </td>
            </tr>
          )}
          {!isLoading && loadError && (
            <tr>
              <td colSpan={4} className="text-danger text-sm px-4 py-8 text-center">
                {loadError}
              </td>
            </tr>
          )}
          {!isLoading && !loadError && years.length === 0 && (
            <tr>
              <td colSpan={4} className="text-text-muted text-sm px-4 py-8 text-center">
                年度がまだ登録されていません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 年度の追加 */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <label htmlFor="fiscal-year-input" className="text-xs font-semibold text-text-muted">
          年度を追加（年度が始まる年を西暦で入力）
        </label>
        <div className="flex items-center gap-2">
          <input
            id="fiscal-year-input"
            type="number"
            inputMode="numeric"
            className="gt-field w-[140px]"
            placeholder="例: 2026"
            value={startYearInput}
            onChange={(e) => setStartYearInput(e.target.value)}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={isAdding || parsedYear === null}
            className="gt-btn-primary flex items-center gap-1 text-xs disabled:opacity-60"
          >
            {isAdding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            追加
          </button>
          {preview && (
            <span className="text-xs text-text-muted">
              {preview.label}（{formatFiscalYearPeriod(preview.startDate, preview.endDate)}）
            </span>
          )}
        </div>
      </div>

      {/* 削除確認モーダル */}
      <Modal
        isOpen={yearToDelete !== null}
        onClose={() => { if (!isDeleting) setYearToDelete(null); }}
        title="年度の削除確認"
      >
        <div className="flex flex-col gap-6">
          <p className="text-sm text-text-main">
            算定年度「<strong>{yearToDelete?.label}</strong>」を削除してもよろしいですか？
            <br />
            削除すると、この年度は社内のメンバー全員の画面で年度の選択肢に表示されなくなります。
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="gt-btn"
              onClick={() => setYearToDelete(null)}
              disabled={isDeleting}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="gt-btn-primary bg-danger hover:bg-danger/90 flex items-center gap-2"
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 size={16} className="animate-spin" />}
              削除する
            </button>
          </div>
        </div>
      </Modal>
    </Card>
  );
};
