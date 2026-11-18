// メンバーロール（権限区分）は認証・設定・各画面の出し分けなど複数機能で共有する
// ドメイン値のため、全体共有の型としてここに置く（AGENTS.md R3）。
// 値の正本は DB の check 制約（supabase/migrations/20260831000000_schema.sql の
// profiles_role_check / invites_role_check）。
//
// ロールは「管理者」（'admin'）・「メンバー」（'logger'）・「閲覧者」（'viewer'）の 3 つ。判定は 2 つの軸で行う。
// - isAdmin(): 組織の設定（企業情報・算定年度・メンバーの招待・削除・ロールの変更）を変えられるか。管理者だけ。
// - canWrite(): データの入力・算定・拠点や排出係数の編集・IDEA の取込・削減目標・Scope 3 の入力方式など、
//   組織のデータを書き換えられるか。管理者とメンバー。閲覧者は見るだけ（レポートの出力・CSV エクスポートはできる）。
// 新しくメンバーにするときに書く値は 'logger'（DB の既定値）。'member' という値は足さない
// （既存の行を書き換えるデータの更新をマイグレーションに書けないため: AGENTS.md R12）。
//
// 画面はこの 2 つの判定で出し分けるだけにする。権限の正しさはサーバ（src/lib/authz.ts の requireAdmin）と
// DB（RLS・RPC）で確かめる。

export const MEMBER_ROLES = ['admin', 'logger', 'viewer'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

// 招待・ロールの変更で書ける値（管理者 / メンバー / 閲覧者）。
export const ASSIGNABLE_MEMBER_ROLES = ['admin', 'logger', 'viewer'] as const;

export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];

export const ADMIN_ROLE: AssignableMemberRole = 'admin';
export const MEMBER_ROLE: AssignableMemberRole = 'logger';
export const VIEWER_ROLE: AssignableMemberRole = 'viewer';

export const isMemberRole = (value: unknown): value is MemberRole =>
  typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);

export const isAssignableMemberRole = (value: unknown): value is AssignableMemberRole =>
  typeof value === 'string' && (ASSIGNABLE_MEMBER_ROLES as readonly string[]).includes(value);

export const isAdmin = (role: MemberRole | null | undefined): boolean => role === 'admin';

// ロールが取れていない（未ログイン・プロフィールの取得失敗）ときは書けない側に倒す。
export const canWrite = (role: MemberRole | null | undefined): boolean =>
  role === 'admin' || role === 'logger';

// 画面の表示名。
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  admin: '管理者',
  logger: 'メンバー',
  viewer: '閲覧者',
};

// 招待・ロールの選択肢に添える説明。
export const MEMBER_ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  admin: 'データの入力・編集に加えて、組織の設定（企業情報・算定年度・メンバー）を変えられます',
  logger: 'データの入力・算定、拠点や排出係数の編集ができます。組織の設定は見るだけです',
  viewer: '内容を見ることと、レポートの出力・CSV エクスポートができます。編集はできません',
};

export const memberRoleLabel = (role: MemberRole): string => MEMBER_ROLE_LABELS[role];
