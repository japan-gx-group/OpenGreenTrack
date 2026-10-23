// メンバーロール（権限区分）は認証・設定・各画面の出し分けなど複数機能で共有する
// ドメイン値のため、全体共有の型としてここに置く（AGENTS.md R3）。
// 値の正本は DB の check 制約（supabase/migrations/20260831000000_schema.sql の
// profiles_role_check / invites_role_check）。
//
// ロールは「管理者」と「メンバー」の 2 つ。role が 'admin' なら管理者、それ以外（'logger'・'viewer'）は
// すべてメンバーとして扱い、判定は isAdmin() だけで行う（'logger' や 'viewer' を個別に判定しない）。
// 新しくメンバーにするときに書く値は 'logger'（DB の既定値）。'member' という値は足さない
// （既存の行を書き換えるデータの更新をマイグレーションに書けないため: AGENTS.md R12）。
//
// 管理者だけに限っているのは、ロールの変更とメンバーの削除。組織の設定（企業情報・算定年度・招待）は
// まだ全員が変えられる（RLS の current_user_is_admin() は「ログインしているか」を返したまま）。

export const MEMBER_ROLES = ['admin', 'logger', 'viewer'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

// ロールを変えるときに書ける値（管理者 / メンバー）。'viewer' は既存の行に残る値で、新しくは書かない。
export const ASSIGNABLE_MEMBER_ROLES = ['admin', 'logger'] as const;

export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];

export const ADMIN_ROLE: AssignableMemberRole = 'admin';
export const MEMBER_ROLE: AssignableMemberRole = 'logger';

export const isMemberRole = (value: unknown): value is MemberRole =>
  typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);

export const isAssignableMemberRole = (value: unknown): value is AssignableMemberRole =>
  typeof value === 'string' && (ASSIGNABLE_MEMBER_ROLES as readonly string[]).includes(value);

export const isAdmin = (role: MemberRole | null | undefined): boolean => role === 'admin';

// 画面の表示名。'logger'・'viewer' はどちらも「メンバー」。
export const memberRoleLabel = (role: MemberRole): string => (isAdmin(role) ? '管理者' : 'メンバー');
