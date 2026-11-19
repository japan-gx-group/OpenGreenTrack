'use client';

// レポートの中の画面に共通の情報（ロール・利用者の一覧・最新の差戻し・進み具合・今いる画面）。レイアウト（app/(app)/ssbj/[reportId]/layout.tsx）の
// SsbjReportOverviewProvider がレポートを開いている間 1 回だけ読み、画面の上の部品（SsbjReportHeader）と各画面が同じ値を使う
// （画面を移るたびに同じものを取りに行かないため）。
// Provider の外（単体で描いた画面など）では null を返すので、使う側は null のときに出さない・何もしないようにする。
// ロールと利用者の一覧は useSsbjReportMyRole / useSsbjReportMembers で読む（Provider の中では Provider の値、外では自分で読む）。

import { createContext, useContext } from 'react';
import type { SsbjReopenNotice } from '../utils/auditLog';
import type { SsbjReportRoute } from '../utils/reportRoute';
import { useSsbjMembers, type SsbjMembersState } from './useSsbjMembers';
import { useSsbjMyRole, type SsbjMyRoleState } from './useSsbjMyRole';
import type { SsbjReportProgressState } from './useSsbjReportProgress';

export interface SsbjReportOverview {
  reportId: string;
  /** 今いる画面（詳細画面は current = ''）。 */
  route: SsbjReportRoute;
  role: SsbjMyRoleState;
  /** 利用者の一覧。詳細画面にいるときと、差戻しの帯を出すときだけ読む（それまでは読み込み中のまま）。 */
  members: SsbjMembersState;
  /** 作業中の内容を見られるか（ロールの読み込みが終わり、閲覧者でない）。false の間は作業中の内容を読まない・出さない。 */
  workingAccess: boolean;
  /** 最新の状態の変更が差戻しなら、その理由・誰が・いつ。 */
  reopen: { notice: SsbjReopenNotice | null; isLoading: boolean; errorMessage: string };
  /** 作業中の内容から数えた進み具合（utils/reportProgress.ts）。閲覧者には数えない。作業中の内容が書き換わったら読み直す。 */
  progress: SsbjReportProgressState;
  /** 状態の変更（依頼・差戻しなど）の後に、差戻しの知らせを読み直す。 */
  reloadStatus: () => void;
}

export const SsbjReportOverviewContext = createContext<SsbjReportOverview | null>(null);

export const useSsbjReportOverview = (): SsbjReportOverview | null => useContext(SsbjReportOverviewContext);

/** ログイン中の利用者の SSBJ のロール。Provider の中では Provider が読んだ値を使い、読み直さない。 */
export const useSsbjReportMyRole = (): SsbjMyRoleState => {
  const overview = useSsbjReportOverview();
  const own = useSsbjMyRole(!overview);
  return overview ? overview.role : own;
};

/** 自組織の利用者の一覧。Provider の中では Provider が読んだ値を使い、読み直さない。 */
export const useSsbjReportMembers = (): SsbjMembersState => {
  const overview = useSsbjReportOverview();
  const own = useSsbjMembers(!overview);
  return overview ? overview.members : own;
};
