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

export const useSsbjMembers = (): SsbjMembersState => {
  const [state, setState] = useState<SsbjMembersState>({
    members: [], currentUserId: null, currentRole: null, isLoading: true, errorMessage: '',
  });

  useEffect(() => {
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
  }, []);

  return state;
};
