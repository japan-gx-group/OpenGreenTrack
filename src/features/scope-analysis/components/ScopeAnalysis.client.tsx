'use client';

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { PageHeading } from '@/components/layout/PageHeading';
import { RefreshingIndicator } from '@/components/ui/RefreshingIndicator';
import { CheckCircle, X } from 'lucide-react';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import { useFiscalYearFromQuery } from '../hooks/useFiscalYearFromQuery';
import { Scope3CategoryChart } from './Scope3CategoryChart.client';
import { ScopeMixCard } from './ScopeMixCard';
import { Scope3MethodPanel } from './Scope3MethodPanel.client';
import { getScopeAnalysisData, type Scope3Method, type ScopeAnalysisData } from '../services/scopeAnalysisService';
import {
  saveScope3CategoryMethod,
  saveScope3DirectEmissions,
} from '../services/scope3MethodService';

const TOAST_VISIBLE_MS = 5000;

export const ScopeAnalysis = () => {
  // 他画面の導線が URL で運んできた年度（?fy=）を選択年度へ適用する。
  useFiscalYearFromQuery();
  const { fiscalYear, fiscalYearId, fiscalYears, isLoading: isFiscalYearLoading } = useFiscalYear();
  const { refreshToken } = useAppRefresh();
  // 年度が1件も無い（初期セットアップ直後・最後の年度を削除した後）。fiscalYear が空文字の
  // ままだと下の取得 effect が走らず「読み込んでいます...」から抜けられないため、
  // Context のロード完了後に判定して空状態の案内へ切り替える。
  const hasNoFiscalYear = !isFiscalYearLoading && fiscalYears.length === 0;
  const [scopeAnalysisData, setScopeAnalysisData] = useState<ScopeAnalysisData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // 方式切替・直接入力値保存の結果通知トースト。
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, TOAST_VISIBLE_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // 年度切替・保存後の再取得が並走したとき、後着の古い結果で新しい表示を上書きしないよう
  // リクエスト番号で最後の呼び出しだけを反映する。保存後の手動再取得からも呼ぶため、
  // effect のクリーンアップやマウント判定だけでは守れない。
  const requestIdRef = useRef(0);

  const loadScopeAnalysisData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setErrorMessage('');
    // 取得完了までは前回年度のデータを保持したまま表示し（stale-while-revalidate、白画面回避）、
    // 「更新中」を明示する。ここで null にすると切替のたびに全面ローディングへ戻ってしまう。

    try {
      const data = await getScopeAnalysisData(fiscalYear, fiscalYearId);
      if (requestIdRef.current === requestId) {
        setScopeAnalysisData(data);
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setScopeAnalysisData(null);
        setErrorMessage(error instanceof Error ? error.message : 'Scope分析データの取得に失敗しました');
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [fiscalYear, fiscalYearId]);

  useEffect(() => {
    // FiscalYearContext のロード完了前は fiscalYear が空文字。このまま取得すると
    // 不正な年度クエリでエラー表示になるため、実際の年度が入るまで待つ。
    if (fiscalYear === '') return;

    // 同期 setState を避けるためマイクロタスクへ逃がす（react-hooks/set-state-in-effect 対策）。
    Promise.resolve().then(() => loadScopeAnalysisData());
  }, [fiscalYear, loadScopeAnalysisData, refreshToken]);

  const categoryData = useMemo(
    () => scopeAnalysisData?.categories ?? [],
    [scopeAnalysisData],
  );

  // 方式切替。upsert → refresh_dashboard_aggregates（Route Handler 経由）→ 再取得。
  // 切替直後に scope3Total・採用値が更新される（算定バッチの再実行は不要）。
  const handleSwitchMethod = useCallback(
    async (categoryId: number, method: Scope3Method) => {
      if (!scopeAnalysisData) return;
      try {
        await saveScope3CategoryMethod(scopeAnalysisData.fiscalYearId, categoryId, method);
        await loadScopeAnalysisData();
        showToast(
          method === 'calculated'
            ? `カテゴリ${categoryId}を積上げ算定に切り替えました（直接入力値は未採用として保持されます）`
            : `カテゴリ${categoryId}を直接入力に切り替えました`,
          'success',
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : '算定方法の切替に失敗しました', 'error');
      }
    },
    [scopeAnalysisData, loadScopeAnalysisData, showToast],
  );

  // direct 方式の値の保存。upsert → 再集計 → 再取得。
  const handleSaveDirect = useCallback(
    async (categoryId: number, emissions: number, dataSourceNote: string) => {
      if (!scopeAnalysisData) return;
      // 失敗はモーダル内に表示するため throw のまま伝播させる。
      await saveScope3DirectEmissions(
        scopeAnalysisData.fiscalYearId,
        categoryId,
        emissions,
        dataSourceNote,
      );
      await loadScopeAnalysisData();
      showToast(`カテゴリ${categoryId}の直接入力値を保存しました`, 'success');
    },
    [scopeAnalysisData, loadScopeAnalysisData, showToast],
  );

  if (hasNoFiscalYear) {
    return (
      <div className="page-content gt-scroll relative">
        <PageHeading title="Scope分析" description="Scope 1・2・3 の構成と Scope 3 の算定方法" />
        <div className="gt-card" style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          <p style={{ margin: 0 }}>算定年度が登録されていません。企業設定から年度を追加してください。</p>
          <Link href="/settings/company" className="gt-btn" style={{ marginTop: '12px' }}>
            企業設定へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading title="Scope分析" description="Scope 1・2・3 の構成と Scope 3 の算定方法" />

      {/* 年度切替時は前回データを保持したまま浮遊インジケータのみ出し、レイアウトのズレを避ける。
          初回ロード（データ未取得）は各カード内の「読み込んでいます...」で明示する。 */}
      <RefreshingIndicator show={isLoading && scopeAnalysisData !== null} top="22px" right="26px" />

      {toast && (
        <div
          className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm ${
            toast.type === 'success'
              ? 'border-success bg-primary-bg text-success'
              : 'border-danger bg-danger-light text-danger'
          }`}
          style={{ marginBottom: '14px' }}
          role="status"
        >
          {toast.type === 'success' && <CheckCircle size={16} className="mt-0.5 shrink-0" />}
          <span className="whitespace-pre-line">{toast.message}</span>
          <button
            type="button"
            className="ml-auto shrink-0"
            onClick={() => setToast(null)}
            aria-label="通知を閉じる"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          className="rounded-md border border-danger bg-danger-light px-4 py-3 text-sm text-danger"
          style={{ marginBottom: '14px' }}
        >
          {errorMessage}
        </div>
      )}

      <div className="flex flex-col" style={{ gap: '14px' }}>
        {/* ===== Scope 別構成 ===== */}
        {scopeAnalysisData && (
          <ScopeMixCard totals={scopeAnalysisData.scopeTotals} isStale={isLoading} />
        )}

        {/* ===== Scope 3 カテゴリ別排出量（ドーナツ＋カテゴリ一覧）===== */}
        <section className="gt-card">
          <div className="gt-card-head">
            <div>
              <h2 className="gt-card-title">Scope 3 カテゴリ別排出量</h2>
              <p className="gt-card-sub">採用値・構成比の大きい順・単位 t-CO2e</p>
            </div>
          </div>

          <div style={{ marginTop: '18px' }}>
            {isLoading && categoryData.length === 0 ? (
              <div className="text-sm text-text-muted">Scope 3カテゴリ別データを読み込んでいます...</div>
            ) : categoryData.length === 0 ? (
              <div className="text-sm text-text-muted">対象年度のScope 3カテゴリ別データはまだ登録されていません。</div>
            ) : (
              <Scope3CategoryChart categories={categoryData} />
            )}
          </div>
        </section>

        {/* カテゴリ別の算定方法管理（方法バッジ・切替・direct 値の編集・製品別ドリルダウン） */}
        <section className="gt-card">
          <div className="gt-card-head">
            <div>
              <h2 className="gt-card-title">カテゴリ別の算定方法</h2>
              <p className="gt-card-sub">
                直接入力は登録した排出量をそのまま採用し、積上げは活動量に IDEA 原単位を掛けて算定します
              </p>
            </div>
          </div>
          {/* 操作ヒント（製品別内訳の開き方）は一覧側のカテゴリ名ボタンに寄せ、ここは切替の挙動だけを書く */}
          <p style={{ margin: '12px 0 16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
            算定方法を切り替えると、Scope 3 の合計はすぐに再集計されます。積上げに切り替えても直接入力値は消えず、
            「未採用」として保持されるためいつでも直接入力に戻せます。
          </p>

          {isLoading && scopeAnalysisData === null ? (
            <div className="text-sm text-text-muted">算定方法データを読み込んでいます...</div>
          ) : scopeAnalysisData === null ? (
            <div className="text-sm text-text-muted">算定方法データを取得できませんでした。</div>
          ) : (
            <>
              <Scope3MethodPanel
                // 年度切替時に再マウントし、パネル内部のドリルダウンキャッシュ・展開状態を破棄する
                // （キャッシュはカテゴリIDキーのため、key が無いと前年度の製品別内訳が残る）。
                key={scopeAnalysisData.fiscalYearId}
                items={scopeAnalysisData.methodItems}
                fiscalYearId={scopeAnalysisData.fiscalYearId}
                onSwitchMethod={handleSwitchMethod}
                onSaveDirect={handleSaveDirect}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
};
