'use client';

// 自組織の SSBJ のロールの割り当て（利用者 ID → ロール）。承認者の候補（承認担当か管理者）を選ぶのに使う。
// 割り当ての無い利用者は入力担当（utils/memberRole.ts の effectiveSsbjRole で決める）。

import { useEffect, useState } from 'react';
import { listSsbjMemberRoles } from '../services/memberRoleService';
import type { SsbjMemberRole } from '../types';

export interface SsbjMemberRoleMapState {
  roles: Map<string, SsbjMemberRole>;
  isLoading: boolean;
  errorMessage: string;
}

export const useSsbjMemberRoleMap = (): SsbjMemberRoleMapState => {
  const [state, setState] = useState<SsbjMemberRoleMapState>({ roles: new Map(), isLoading: true, errorMessage: '' });

  useEffect(() => {
    let active = true;
    listSsbjMemberRoles()
      .then(roles => {
        if (active) setState({ roles, isLoading: false, errorMessage: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ roles: new Map(), isLoading: false,
          errorMessage: error instanceof Error ? error.message : 'SSBJ のロールの取得に失敗しました' });
      });
    return () => { active = false; };
  }, []);

  return state;
};
