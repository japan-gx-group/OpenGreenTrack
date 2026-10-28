// AI の設定の状態（GET）。企業・メンバー設定の「AI の設定」カードと、AI を使う機能が「使えるか」を知るために呼ぶ。
//
// 全メンバーが呼べる（何に送られるかを誰でも確かめられるようにするため）。返すのは、方式・提供元・使える状態か・
// 選択中のモデル・自分が設定を変えられるか（管理者か）と、方式B の登録の状態（末尾 4 文字・更新日時・登録し直しが必要か）
// だけで、API キーの値・暗号文は返さない。
// 登録した鍵の行（ai_credentials）は authenticated から読めないので service_role で読む。そのため組織は
// ログイン中のプロフィールの organizationId に限り、読む列も提供元・指紋・末尾 4 文字・更新日時だけにする。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { readAiConfig } from '@/lib/ai/config';
import { buildAiStatus, type CredentialMetadata, type SettingsRow } from '@/lib/ai/status';
import { isAdmin } from '@/types/role';

export const runtime = 'nodejs';

export const GET = async () => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const config = readAiConfig();
  if (!config.ok && config.problem !== 'not_configured') {
    // 未設定（AI を使わない環境）はふつうの状態。値が正しくないときだけ運用担当が気づけるよう残す。
    log.warn({ problem: config.problem }, 'AI の設定（環境変数）が正しくありません');
  }
  if (config.ok && config.keySource === 'app' && config.ignoresServerKey) {
    log.warn('方式B（画面からの鍵の登録）では AI_API_KEY を読みません。環境変数から外してください');
  }

  // RLS（ai_settings_select_own_organization）により自組織の 1 行だけが返る。
  const supabase = await createClient();
  const [settingsResult, credentialResult] = await Promise.all([
    supabase.from('ai_settings').select('provider, modelId').maybeSingle(),
    createAdminClient()
      .from('ai_credentials')
      .select('provider, keyId, keyLast4, updatedAt')
      .eq('organizationId', profile.organizationId)
      .maybeSingle(),
  ]);
  if (settingsResult.error || credentialResult.error) {
    log.error(
      { error: settingsResult.error ?? credentialResult.error },
      'AI の設定の取得に失敗しました',
    );
    return NextResponse.json({ error: 'AI の設定の取得に失敗しました' }, { status: 500 });
  }

  return NextResponse.json(
    buildAiStatus({
      config,
      credential: (credentialResult.data as CredentialMetadata | null) ?? null,
      settings: (settingsResult.data as SettingsRow | null) ?? null,
      canManage: isAdmin(profile.role),
    }),
  );
};
