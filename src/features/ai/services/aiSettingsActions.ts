'use server';

// AI の設定の Server Action（モデルの保存）。
//
// 管理者だけに許す（requireAdmin）。ai_settings は authenticated に書き込みの権限が無いので、
// 管理者であることを確かめたうえで service_role から書く（RLS を越えるため、組織の限定はここでしか担保できない）。
// ブラウザから送られたモデル ID はそのまま信じず、形を確かめ、提供元の一覧を取り直して含まれることを確かめてから保存する。
// 変更は system_audit_logs に ai.model.update として残す。

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/authz';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { listAvailableModels } from '@/lib/ai/models';
import { isValidAiModelId } from '@/types/ai';
import type { ActionResult } from '@/types/actionResult';

export const saveAiModel = async (modelId: string): Promise<ActionResult<{ modelId: string }>> => {
  const check = await requireAdmin();
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const caller = check.profile;

  if (!isValidAiModelId(modelId)) {
    return { ok: false, error: 'モデルの ID が正しくありません' };
  }

  const log = await getRequestLogger();
  const listed = await listAvailableModels(caller.organizationId);
  if (!listed.ok) {
    log.warn({ reason: listed.reason }, 'モデルの保存の前に、モデル一覧を取得できませんでした');
    return { ok: false, error: listed.error };
  }
  if (!listed.models.some((model) => model.id === modelId)) {
    return {
      ok: false,
      error: '選んだモデルは提供元の一覧にありません。一覧を取り直してから選んでください',
    };
  }

  const admin = createAdminClient();
  const { data: previous, error: readError } = await admin
    .from('ai_settings')
    .select('provider, modelId')
    .eq('organizationId', caller.organizationId)
    .maybeSingle();
  if (readError) {
    return { ok: false, error: 'モデルの保存に失敗しました' };
  }
  if (previous?.provider === listed.provider && previous?.modelId === modelId) {
    return { ok: true, data: { modelId } };
  }

  const { error: upsertError } = await admin.from('ai_settings').upsert(
    {
      organizationId: caller.organizationId,
      provider: listed.provider,
      modelId,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: 'organizationId' },
  );
  if (upsertError) {
    log.error({ error: upsertError }, 'AI のモデルの保存に失敗しました');
    return { ok: false, error: 'モデルの保存に失敗しました' };
  }

  // 保存はもう済んでいるので、記録に失敗しても成功として返し、ログにだけ残す。
  const { error: auditError } = await admin.from('system_audit_logs').insert({
    organizationId: caller.organizationId,
    userId: caller.id,
    action: 'ai.model.update',
    entityName: 'ai_settings',
    detail: JSON.stringify({
      provider: listed.provider,
      modelId,
      previousProvider: previous?.provider ?? null,
      previousModelId: previous?.modelId ?? null,
    }),
  });
  if (auditError) {
    log.error({ error: auditError }, 'AI のモデルの変更の記録に失敗しました');
  }

  return { ok: true, data: { modelId } };
};
