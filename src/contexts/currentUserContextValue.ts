'use client';

import { createContext } from 'react';
import type { MemberRole } from '@/types/role';

export type CurrentUserProfile = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
  /** 所属組織名（organizations.name）。取得失敗時は null */
  organizationName: string | null;
};

export type CurrentUserContextValue = {
  /** ログイン中ユーザーのプロフィール。未ログイン・未取得時は null */
  profile: CurrentUserProfile | null;
  /**
   * profile?.role の短縮。未ログイン・プロフィール取得失敗時は null。
   * ロール無効化中のため権限判定には使わないこと。DB に残る値の参照用。
   */
  role: MemberRole | null;
  isLoading: boolean;
  /** プロフィールを取り直す */
  refresh: () => Promise<void>;
};

export const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);
