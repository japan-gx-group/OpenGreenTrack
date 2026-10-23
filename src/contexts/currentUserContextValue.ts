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
   * 画面の出し分け（src/types/role.ts の isAdmin）に使う。ブラウザに残った古い値のことがあるため、
   * 権限の正しさはサーバ（src/lib/authz.ts の requireAdmin）と DB で確かめる。
   */
  role: MemberRole | null;
  isLoading: boolean;
  /** プロフィールを取り直す */
  refresh: () => Promise<void>;
};

export const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);
