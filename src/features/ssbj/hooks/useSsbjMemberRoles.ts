'use client';

// SSBJ の権限の画面（/ssbj/roles）の読込と割り当て: 自組織の利用者・割り当て・変更の記録を読み、
// 管理者がロールを割り当てる。割り当てたら読み直す（変更の記録は DB のトリガーが書く）。

import { useCallback, useEffect, useState } from 'react';
import { listSsbjMembers, type SsbjMember } from '../services/memberService';
import { assignSsbjMemberRole, listSsbjMemberRoleLogs, listSsbjMemberRoles } from '../services/memberRoleService';
import type { SsbjMemberRole, SsbjMemberRoleLog } from '../types';

type Loaded = {
  members: SsbjMember[];
  roles: Map<string, SsbjMemberRole>;
  logs: SsbjMemberRoleLog[];
};

export interface SsbjMemberRolesController extends Loaded {
  isLoading: boolean;
  errorMessage: string;
  /** 保存中の利用者 ID（保存中でなければ null）。 */
  savingUserId: string | null;
  /** 割り当てる。成功したら true、失敗したら false を返す（理由は errorMessage）。 */
  assign: (userId: string, role: SsbjMemberRole) => Promise<boolean>;
}

const EMPTY: Loaded = { members: [], roles: new Map(), logs: [] };

export const useSsbjMemberRoles = (): SsbjMemberRolesController => {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [members, roles, logs] = await Promise.all([listSsbjMembers(), listSsbjMemberRoles(), listSsbjMemberRoleLogs()]);
    setLoaded({ members, roles, logs });
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([listSsbjMembers(), listSsbjMemberRoles(), listSsbjMemberRoleLogs()])
      .then(([members, roles, logs]) => {
        if (!active) return;
        setLoaded({ members, roles, logs });
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'SSBJ のロールの取得に失敗しました');
        setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const assign = async (userId: string, role: SsbjMemberRole): Promise<boolean> => {
    if (savingUserId) return false;
    setSavingUserId(userId);
    setErrorMessage('');
    try {
      await assignSsbjMemberRole(userId, role);
      await load();
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'SSBJ のロールの保存に失敗しました');
      return false;
    } finally {
      setSavingUserId(null);
    }
  };

  return { ...loaded, isLoading, errorMessage, savingUserId, assign };
};
