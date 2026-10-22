'use client';

// ログイン中の利用者の SSBJ のロール（docs/authorization-matrix.md §1）。画面の出し分けに使う。
// 正しさは DB と Route Handler が担保するので、取得に失敗したときは操作を出さない側に倒す（role = null）。

import { useEffect, useState } from 'react';
import { getMySsbjRole } from '../services/memberRoleService';
import type { SsbjEffectiveRole } from '../types';

export interface SsbjMyRoleState {
  role: SsbjEffectiveRole | null;
  isLoading: boolean;
  errorMessage: string;
}

export const useSsbjMyRole = (): SsbjMyRoleState => {
  const [state, setState] = useState<SsbjMyRoleState>({ role: null, isLoading: true, errorMessage: '' });

  useEffect(() => {
    let active = true;
    getMySsbjRole()
      .then(role => {
        if (active) setState({ role, isLoading: false, errorMessage: '' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ role: null, isLoading: false,
          errorMessage: error instanceof Error ? error.message : 'SSBJ のロールの取得に失敗しました' });
      });
    return () => { active = false; };
  }, []);

  return state;
};
