'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FiscalYearContext, type FiscalYearOption } from './fiscalYearContextValue';

type FiscalYearRow = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

const deriveYear = (label: string, startDate: string): string =>
  label.match(/\d{4}/)?.[0] ?? startDate.slice(0, 4);

export const FiscalYearProvider = ({ children }: { children: ReactNode }) => {
  // SSRではlocalStorage/Supabaseセッションが無いため、初期値は空にして
  // マウント後にクライアント側で取得・復元する（AGENTS.md R6参照）。
  const [fiscalYears, setFiscalYears] = useState<FiscalYearOption[]>([]);
  const [fiscalYearId, setFiscalYearIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // refresh() 用に「誰でログイン中か」を保持する。auth イベント外から取り直す際に getUser を
  // 呼び直さずに済ませるため（コールバック内の supabase.auth 直呼びはデッドロックし得る）。
  const userIdRef = useRef<string | null>(null);
  // アンマウント後の setState を防ぐ。load は auth イベントと refresh() の両方から呼ばれる。
  const activeRef = useRef(true);

  const load = useCallback(async (userId: string | null) => {
    const supabase = createClient();
    userIdRef.current = userId;
    // 認証前（ログイン/招待/サインアップ画面）や未ログイン時は fiscal_years を読めない。
    if (!userId) {
      if (activeRef.current) {
        setFiscalYears([]);
        setFiscalYearIdState(null);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);

    // fiscal_years の RLS（fiscal_years_select_own_organization）は自組織の年度だけを返す。
    // グループ会社（子孫組織）の仕組みは撤去済みのため、organizationId で
    // 追加で絞り込む必要はなく、profiles を引く往復も不要。
    const { data, error } = await supabase
      .from('fiscal_years')
      .select('id, label, startDate, endDate')
      .order('startDate', { ascending: false });

    if (!activeRef.current) return;

    if (error || !data) {
      setFiscalYears([]);
      setIsLoading(false);
      return;
    }

    const options: FiscalYearOption[] = (data as FiscalYearRow[]).map(row => ({
      id: row.id,
      label: row.label,
      year: deriveYear(row.label, row.startDate),
      startDate: row.startDate,
      endDate: row.endDate,
    }));
    setFiscalYears(options);

    // 既定は常に最新年度（startDate 降順ソート済みなので options[0] が最新）。
    // 「基本的に最新年度を表示」方針のため、古い選択を localStorage から復元して
    // 過去年度に固定されるのを避ける。同一マウント中に手動で選んだ年度（prev）だけは保持する。
    // 「現在の年度」（今日が期間内の年度）とは別の概念。表示上の「現在」は isCurrentFiscalYear で導出する。
    setFiscalYearIdState(prev => {
      if (prev && options.some(option => option.id === prev)) return prev;
      const latest = options[0];
      return latest ? latest.id : null;
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const supabase = createClient();

    // onAuthStateChange は購読直後に INITIAL_SESSION を、ログイン/ログアウト時に
    // SIGNED_IN / SIGNED_OUT を発火する。ルート直下の Provider は client 遷移では
    // 再マウントされないため、getUser の一度きり取得ではなくこのイベントで追随する。
    // コールバック内での supabase.auth 直呼びはデッドロックし得るので setTimeout(0) で外す。
    //
    // 再取得するのは「誰がログインしているか」が変わり得るイベントだけに絞る。
    // TOKEN_REFRESHED（約1時間ごとのアクセストークン更新）や PASSWORD_RECOVERY でも
    // 取り直すと、内容が同じでも fiscalYears が新しい配列になり、これを依存に持つ
    // 画面側の effect（ダッシュボードの年度別集計・削減目標の再取得など）が
    // 無駄に走り直してしまうため。
    const RELOAD_EVENTS = new Set(['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED']);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!RELOAD_EVENTS.has(event)) return;
      setTimeout(() => {
        void load(session?.user.id ?? null);
      }, 0);
    });

    return () => {
      activeRef.current = false;
      subscription.unsubscribe();
    };
  }, [load]);

  const refresh = useCallback(() => load(userIdRef.current), [load]);

  // 年度選択は永続化しない（リロードで最新年度に戻す方針）。同一マウント中は state で保持される。
  const setFiscalYearId = useCallback((id: string) => {
    setFiscalYearIdState(id);
  }, []);

  const value = useMemo(() => {
    const selected = fiscalYears.find(option => option.id === fiscalYearId) ?? null;
    return {
      fiscalYearId,
      fiscalYear: selected?.year ?? '',
      fiscalYears,
      isLoading,
      setFiscalYearId,
      refresh,
    };
  }, [fiscalYearId, fiscalYears, isLoading, setFiscalYearId, refresh]);

  return (
    <FiscalYearContext.Provider value={value}>
      {children}
    </FiscalYearContext.Provider>
  );
};
