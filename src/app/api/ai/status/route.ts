// AI の設定の状態（GET）。企業・メンバー設定の「AI の設定」カードと、AI を使う機能が「使えるか」を知るために呼ぶ。
//
// 全メンバーが呼べる（何に送られるかを誰でも確かめられるようにするため）。返すのは、方式・提供元・設定済みか・
// 選択中のモデル・自分が設定を変えられるか（管理者か）だけで、API キーの値は返さない。
// 選択中のモデルは、選んだ時点の提供元が今の提供元と同じときだけ返す（提供元を替えたら選び直す）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createClient } from '@/lib/supabase/server';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { readAiConfig } from '@/lib/ai/config';
import { isAdmin } from '@/types/role';
import type { AiStatus } from '@/types/ai';

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

  // RLS（ai_settings_select_own_organization）により自組織の 1 行だけが返る。
  const supabase = await createClient();
  const { data, error } = await supabase.from('ai_settings').select('provider, modelId').maybeSingle();
  if (error) {
    log.error({ error }, 'AI の設定の取得に失敗しました');
    return NextResponse.json({ error: 'AI の設定の取得に失敗しました' }, { status: 500 });
  }

  const provider = config.ok ? config.provider : null;
  const status: AiStatus = {
    keySource: 'server',
    configured: config.ok,
    provider,
    modelId: provider && data?.provider === provider ? (data.modelId as string) : null,
    canManage: isAdmin(profile.role),
  };
  return NextResponse.json(status);
};
