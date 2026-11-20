'use client';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { canWrite } from '@/types/role';

/**
 * 書き込みの操作（追加・編集・削除・取込・算定の実行など）を隠すか。閲覧者のとき true。
 *
 * 画面の出し分けにだけ使う。権限の正しさはサーバと DB で確かめる（src/types/role.ts）。
 * プロフィールの読込中は false にして、管理者・メンバーの画面で操作が後から現れて
 * 配置がずれないようにする。読込後にロールが取れなかったときは書けない側に倒す。
 */
export const useReadOnly = (): boolean => {
  const { role, isLoading } = useCurrentUser();
  return !isLoading && !canWrite(role);
};
