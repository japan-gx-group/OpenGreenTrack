// メンバーロール（権限区分）は認証・設定・各画面の出し分けなど複数機能で共有する
// ドメイン値のため、全体共有の型としてここに置く（AGENTS.md R3）。
// 値の正本は DB の check 制約（supabase/migrations/20260831000000_schema.sql の
// profiles_role_check / invites_role_check）。
//
// ロール無効化中: 認証済みユーザーは同一権限として扱うため、ロールによる権限判定は
// アプリ・RLS の双方で行わない（RLS 側は supabase/migrations/20260831000001_rls.sql の
// current_user_can_edit / current_user_is_admin が「認証済みか」だけを返す）。
// 以下は DB に残る role 列の値を扱うための型・検証・表示ラベルのみで、
// 「このロールなら○○できる」という判定をここへ再び追加しないこと。

export const MEMBER_ROLES = ['admin', 'logger', 'viewer'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

// 表示ラベル。ロール無効化中は権限を画面に出さないため現在の参照元は無いが、
// DB に残る role 値を再び表示する場合の正本としてロール無効化の方針どおり維持する。
export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  admin: '管理者',
  logger: '入力担当者',
  viewer: '閲覧者',
};

export const isMemberRole = (value: unknown): value is MemberRole =>
  typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
