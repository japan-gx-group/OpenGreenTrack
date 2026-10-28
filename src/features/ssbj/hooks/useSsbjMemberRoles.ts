'use client';

// SSBJ の権限の画面（/ssbj/roles）の読込と割り当て: 自組織の利用者・割り当て・変更の記録を読み、
// 管理者が選んだロールの変更をまとめて保存する（OGT のメンバー管理と同じく、選んでから「変更を保存」で確定する）。
// 保存したら成否にかかわらず読み直す（変更の記録は DB のトリガーが書く）。

import { useCallback, useEffect, useState } from 'react';
import { listSsbjMembers, type SsbjMember } from '../services/memberService';
import { assignSsbjMemberRole, listSsbjMemberRoleLogs, listSsbjMemberRoles } from '../services/memberRoleService';
import type { SsbjMemberRole, SsbjMemberRoleLog } from '../types';

type Loaded = {
  members: SsbjMember[];
  roles: Map<string, SsbjMemberRole>;
  logs: SsbjMemberRoleLog[];
};

/** 保存するロールの変更（1 人分）。 */
export type SsbjMemberRoleChange = { userId: string; role: SsbjMemberRole };

export interface SsbjMemberRolesController extends Loaded {
  isLoading: boolean;
  errorMessage: string;
  /** 保存中か。 */
  isSaving: boolean;
  /**
   * 変更を順に保存する。すべて保存できたら true。途中で失敗したらそこで止め、false を返す
   * （理由と、それまでに保存した件数は errorMessage）。
   */
  saveChanges: (changes: readonly SsbjMemberRoleChange[]) => Promise<boolean>;
}

const EMPTY: Loaded = { members: [], roles: new Map(), logs: [] };

export const useSsbjMemberRoles = (): SsbjMemberRolesController => {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

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

  const saveChanges = async (changes: readonly SsbjMemberRoleChange[]): Promise<boolean> => {
    if (isSaving || changes.length === 0) return false;
    setIsSaving(true);
    setErrorMessage('');
    let saved = 0;
    try {
      for (const change of changes) {
        await assignSsbjMemberRole(change.userId, change.role);
        saved += 1;
      }
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'SSBJ のロールの保存に失敗しました';
      setErrorMessage(saved > 0 ? `${reason}（${changes.length} 件のうち ${saved} 件は保存済みです）` : reason);
      return false;
    } finally {
      // 成否にかかわらず読み直し、画面と保存した内容をそろえる。
      try {
        await load();
      } catch {
        setErrorMessage(prev => prev || 'SSBJ のロールの取得に失敗しました');
      }
      setIsSaving(false);
    }
  };

  return { ...loaded, isLoading, errorMessage, isSaving, saveChanges };
};
