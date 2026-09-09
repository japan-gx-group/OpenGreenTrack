'use client';

// ログイン中ユーザーのプロフィール（ID・所属組織・表示名）をアプリ全体へ配る Context。
// 組織名の表示やユーザー識別に使う。
// ※ ロールによる画面の出し分けは行わない（ロール判定は無効）。ここへ
//   「このロールなら○○できる」というフラグを再び生やさないこと。書き込み可否は
//   RLS とサーバ側の組織チェックで担保しており、クライアントの値では決めない。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isMemberRole } from '@/types/role';
import {
  CurrentUserContext,
  type CurrentUserProfile,
} from './currentUserContextValue';

export const CurrentUserProvider = ({ children }: { children: ReactNode }) => {
  const [profile, setProfile] = useState<CurrentUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // アンマウント後の setState を避けるためのフラグ（FiscalYearContext と同じ方針）。
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!activeRef.current) return;
    if (!user) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    // サイドバー等での組織名表示のため、自組織（RLSで全ロールにselect許可済み）を1クエリで同時取得する。
    const { data } = await supabase
      .from('profiles')
      .select('id, organizationId, email, fullName, role, organizations(name)')
      .eq('id', user.id)
      .maybeSingle();
    if (!activeRef.current) return;

    // プロフィールを取得できない場合は profile = null（＝組織名や表示名を出さない）に倒す。
    // role は DB の check 制約と同じ3値であることだけ確認する（権限判定には使わない）。
    if (data && isMemberRole(data.role)) {
      // supabase-js は生成型なしだと埋め込み（organizations(...)）を配列として推論するため正規化する
      // （scopeAnalysisService.ts の suppliers 埋め込みと同じ方針）。
      const orgEmbed = data.organizations as { name: string } | { name: string }[] | null;
      const organization = Array.isArray(orgEmbed) ? (orgEmbed[0] ?? null) : orgEmbed;
      setProfile({
        id: data.id as string,
        organizationId: data.organizationId as string,
        email: data.email as string,
        fullName: (data.fullName as string | null) ?? null,
        role: data.role,
        organizationName: organization?.name ?? null,
      });
    } else {
      setProfile(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const supabase = createClient();

    // onAuthStateChange は購読直後に INITIAL_SESSION を、ログイン/ログアウト時に
    // SIGNED_IN / SIGNED_OUT を発火するため、初回取得と認証変化への追随を兼ねられる。
    // コールバック内での supabase.auth 直呼びはデッドロックし得るので setTimeout(0) で外す
    // （FiscalYearContext と同じ方針）。
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => {
        void refresh();
      }, 0);
    });

    return () => {
      activeRef.current = false;
      subscription.unsubscribe();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      profile,
      role: profile?.role ?? null,
      isLoading,
      refresh,
    }),
    [profile, isLoading, refresh],
  );

  return (
    <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
  );
};
