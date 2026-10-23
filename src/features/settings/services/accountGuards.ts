// アカウント削除の安全ガード（純粋関数）。Route Handler とテストで共有する。

import { isAdmin, type MemberRole } from '@/types/role';

// 組織で「最後の1人」かどうか。true の場合は削除を拒否する。
// 守るのは「メンバー不在の組織が残らないこと」。誰も残らない組織はデータだけが取り残され、
// 招待もできない。
export const isLastMember = (memberCount: number): boolean => memberCount <= 1;

// 組織で「最後の管理者」かどうか。true の場合は削除を拒否する。
// 管理者が 0 人になると、ロールの変更やメンバーの削除をだれもできなくなるため、先に別のメンバーを
// 管理者にしてもらう。DB のトリガー（ensure_organization_keeps_admin）も最後に止めるが、
// 分かりやすいメッセージを返すためにここで先に断る。
export const isLastAdmin = (role: MemberRole, adminCount: number): boolean =>
  isAdmin(role) && adminCount <= 1;
