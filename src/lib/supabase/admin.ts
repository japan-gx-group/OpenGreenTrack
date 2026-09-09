// Client Component からの import をビルド時に失敗させる（AGENTS.md R7 をレビュー頼みにしない）。
import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * service_role キーを使う管理用 Supabase クライアント（サーバ専用）。
 *
 * ⚠️ 重要（AGENTS.md R7）:
 * - このファイルは Server Action / Route Handler / サーバサイドのバッチからのみ import すること。
 * - Client Component（'use client'）から絶対に import しないこと。
 * - service_role キーは RLS をバイパスする管理者権限キー。`NEXT_PUBLIC_` 変数にしない・
 *   ブラウザへ露出させない・コミットしないこと（値は .env.local に置く）。
 *
 * 用途は「RLS を意図的に越える必要があるバッチ処理」に限定する（docs/architecture.md）。
 * 認証と RLS ポリシーが整備されたら、ユーザーセッション経由の
 * src/lib/supabase/server.ts への移行を検討する。
 */
export const createAdminClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase の管理クライアントには NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です（.env.local を確認してください）',
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};
