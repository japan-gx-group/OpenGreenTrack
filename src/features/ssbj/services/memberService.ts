// 自組織の利用者（profiles）の一覧。承認者の選択と、操作履歴・保存版の「誰が」の表示に使う。
// ブラウザの Supabase クライアント（= Client Component）からのみ呼ぶこと。自組織の行だけが見える（RLS）。
// OGT 本体の役割（profiles.role）は表示と、管理者かどうかの案内に使うだけで、ここでは書き換えない。

import { createClient } from '@/lib/supabase/client';
import { isMemberRole, type MemberRole } from '@/types/role';

export interface SsbjMember {
  id: string;
  /** 表示名（氏名、無ければメールアドレス）。 */
  name: string;
  role: MemberRole | null;
}

export const listSsbjMembers = async (): Promise<SsbjMember[]> => {
  const { data, error } = await createClient()
    .from('profiles')
    .select('id, fullName, email, role')
    .order('fullName', { ascending: true });
  if (error) throw new Error('利用者の一覧の取得に失敗しました');
  return (data ?? []).map(row => ({
    id: row.id as string,
    name: (row.fullName as string | null) || (row.email as string),
    role: isMemberRole(row.role) ? row.role : null,
  }));
};

/** ID → 表示名。見つからない（退職・削除など）ときは「不明な利用者」。 */
export const memberName = (members: readonly SsbjMember[], userId: string | null): string => {
  if (!userId) return 'システム';
  return members.find(member => member.id === userId)?.name ?? '不明な利用者';
};

/** ログイン中の利用者の ID（未ログインなら null）。 */
export const getCurrentSsbjUserId = async (): Promise<string | null> => {
  const { data } = await createClient().auth.getUser();
  return data.user?.id ?? null;
};
