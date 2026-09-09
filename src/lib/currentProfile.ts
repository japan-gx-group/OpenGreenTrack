// ログイン中ユーザーの profiles 行（ロール・所属組織）をサーバ側で取得する共通ヘルパー。
// Server Component / Server Action / Route Handler から使う（セッション Cookie 前提）。
// 権限チェック（admin か・書き込みできるか）の判定材料はクライアントから受け取らず、
// 必ずこの関数でサーバ側から取得すること（クライアント値は改ざんできるため）。
//
// ⚠️ サーバ専用: cookies() を使うため Client Component から import しないこと。

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isMemberRole, type MemberRole } from '@/types/role';

export interface CurrentProfile {
  id: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
}

// React の cache() でリクエスト単位にメモ化する。同一リクエスト内で複数回呼ばれても
// auth.getUser()（Supabase Auth へのネットワーク往復）と profiles クエリは1回で済む。
// 例: Route Handler が getRequestLogger() と権限チェックの両方でこれを呼ぶケース。
// キャッシュはリクエストスコープのため、リクエストをまたいだ profile の持ち越しは起きない。
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, organizationId, email, fullName, role')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) {
    return null;
  }

  // DB の check 制約で3値に限定されているが、想定外の値は安全側（権限なし扱い）に倒す。
  if (!isMemberRole(data.role)) {
    return null;
  }

  return {
    id: data.id as string,
    organizationId: data.organizationId as string,
    email: data.email as string,
    fullName: (data.fullName as string | null) ?? null,
    role: data.role,
  };
});
