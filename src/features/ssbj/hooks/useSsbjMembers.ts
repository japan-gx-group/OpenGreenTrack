'use client';

// 自組織の利用者の一覧と、ログイン中の利用者（承認者の選択・承認と差戻しの案内・「誰が」の表示に使う）。

import { useEffect, useState } from 'react';
import type { MemberRole } from '@/types/role';
import { getCurrentSsbjUserId, listSsbjMembers, type SsbjMember } from '../services/memberService';

export interface SsbjMembersState {
  members: SsbjMember[];
  currentUserId: string | null;
  currentRole: MemberRole | null;
  isLoading: boolean;
  errorMessage: string;
}

/**
 * enabled = false の間は読まない（レポートの中の画面で、要るときだけ SsbjReportOverviewProvider が読むため。
 * hooks/useSsbjReportOverview.ts の useSsbjReportMembers）。一度読んだら、enabled が変わっても読み直さない。
 */
export const useSsbjMembers = (enabled = true): SsbjMembersState => {
  const [state, setState] = useState<SsbjMembersState>({
    members: [], currentUserId: null, currentRole: null, isLoading: true, errorMessage: '',
  });
  const [requested, setRequested] = useState<boolean>(false);
  if (enabled && !requested) setRequested(true);

  useEffect(() => {
    if (!requested) return;
    let active = true;
    Promise.all([listSsbjMembers(), getCurrentSsbjUserId()])
      .then(([members, currentUserId]) => {
        if (!active) return;
        const currentRole = members.find(member => member.id === currentUserId)?.role ?? null;
        setState({ members, currentUserId, currentRole, isLoading: false, errorMessage: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(prev => ({ ...prev, isLoading: false,
          errorMessage: error instanceof Error ? error.message : '利用者の一覧の取得に失敗しました' }));
      });
    return () => { active = false; };
  }, [requested]);

  return state;
};
