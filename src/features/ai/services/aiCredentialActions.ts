'use server';

// 画面から登録する AI の API キー（方式B）の Server Action（登録・差し替え・削除）。
//
// - 管理者だけに許す（requireAdmin）。登録は方式B（AI_ALLOW_KEY_REGISTRATION=true）のときだけ。
//   削除は、方式A に戻した後に DB に残った鍵を消せるよう、どちらの方式でも許す。
// - 登録・差し替え・削除のたびに本人確認（ログインパスワードの再入力）を求める（src/lib/reauth.ts）。
//   ログイン状態を盗まれても、パスワードを知らなければ鍵を差し替えられないようにするため。失敗は ai.reauth.failed として残す。
// - 登録する鍵は、その鍵でモデル一覧 API を呼んで使えることを確かめてから、AES-256-GCM で暗号化して保存する。
// - ai_credentials は authenticated から読み書きできないので service_role で書く（組織はログイン情報から取る）。
// - 鍵・パスワードは戻り値・ログ・監査ログに含めない（監査ログに残すのは提供元と末尾 4 文字だけ）。

import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/authz';
import { verifyCurrentPassword } from '@/lib/reauth';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { isValidAiApiKey, readAiConfig } from '@/lib/ai/config';
import { apiKeyLast4, credentialAad, encryptApiKey } from '@/lib/ai/crypto';
import { listModelsWithKey } from '@/lib/ai/models';
import { AI_PROVIDER_LABELS, isAiProviderId, type AiProviderId } from '@/types/ai';
import type { ActionResult } from '@/types/actionResult';

export interface SaveAiCredentialInput {
  provider: AiProviderId;
  apiKey: string;
  /** ログインパスワード（本人確認）。保存もログ出力もしない */
  password: string;
}

const REAUTH_FAILED_MESSAGE = 'ログインパスワードが正しくありません';

type AdminClient = ReturnType<typeof createAdminClient>;

const recordAudit = async (
  admin: AdminClient,
  organizationId: string,
  userId: string,
  action: 'ai.credential.update' | 'ai.credential.delete' | 'ai.reauth.failed',
  detail: Record<string, string | null>,
) => {
  const { error } = await admin.from('system_audit_logs').insert({
    organizationId,
    userId,
    action,
    entityName: 'ai_credentials',
    detail: JSON.stringify(detail),
  });
  if (error) {
    (await getRequestLogger()).error({ error, action }, 'AI の鍵の操作の記録に失敗しました');
  }
};

export const saveAiCredential = async (
  input: SaveAiCredentialInput,
): Promise<ActionResult<{ provider: AiProviderId; last4: string }>> => {
  const check = await requireAdmin();
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const caller = check.profile;

  const config = readAiConfig();
  if (!config.ok || config.keySource !== 'app') {
    return { ok: false, error: '画面からの API キーの登録は有効になっていません' };
  }

  // Server Action はブラウザから任意の値で呼べるため、形から確かめる。
  const provider = input?.provider;
  const apiKey = String(input?.apiKey ?? '').trim();
  const password = String(input?.password ?? '');
  if (!isAiProviderId(provider) || !config.allowedProviders.includes(provider)) {
    return { ok: false, error: 'この提供元の API キーは登録できません' };
  }
  if (!isValidAiApiKey(apiKey)) {
    return { ok: false, error: 'API キーの形が正しくありません（空白や改行を含めず、8〜512 文字で入力してください）' };
  }
  if (!password) {
    return { ok: false, error: 'ログインパスワード（本人確認）を入力してください' };
  }

  const admin = createAdminClient();
  if (!(await verifyCurrentPassword(caller.email, password))) {
    await recordAudit(admin, caller.organizationId, caller.id, 'ai.reauth.failed', { operation: 'credential.update' });
    return { ok: false, error: REAUTH_FAILED_MESSAGE };
  }

  // 登録する鍵が使えるかを、その鍵でモデル一覧を取って確かめる（一覧の取得に利用料はかからない）。
  const listed = await listModelsWithKey(caller.organizationId, provider, apiKey);
  if (!listed.ok) {
    (await getRequestLogger()).warn({ reason: listed.reason, provider }, '登録しようとした AI の鍵を確かめられませんでした');
    const error =
      listed.reason === 'invalid_key'
        ? `この API キーは ${AI_PROVIDER_LABELS[provider]} に受け付けられませんでした。鍵と提供元の組み合わせを確かめてください`
        : listed.error;
    return { ok: false, error };
  }

  const { data: previous } = await admin
    .from('ai_credentials')
    .select('provider')
    .eq('organizationId', caller.organizationId)
    .maybeSingle();

  const encrypted = encryptApiKey(apiKey, config.encryptionKey, credentialAad(caller.organizationId, provider));
  const last4 = apiKeyLast4(apiKey);
  const { error: upsertError } = await admin.from('ai_credentials').upsert(
    {
      organizationId: caller.organizationId,
      provider,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyId: config.encryptionKeyId,
      keyLast4: last4,
      updatedBy: caller.id,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: 'organizationId' },
  );
  if (upsertError) {
    (await getRequestLogger()).error({ error: upsertError }, 'AI の鍵の保存に失敗しました');
    return { ok: false, error: 'API キーの保存に失敗しました' };
  }

  await recordAudit(admin, caller.organizationId, caller.id, 'ai.credential.update', {
    provider,
    last4,
    previousProvider: (previous?.provider as string | undefined) ?? null,
  });
  return { ok: true, data: { provider, last4 } };
};

export const deleteAiCredential = async (input: { password: string }): Promise<ActionResult> => {
  const check = await requireAdmin();
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const caller = check.profile;

  const password = String(input?.password ?? '');
  if (!password) {
    return { ok: false, error: 'ログインパスワード（本人確認）を入力してください' };
  }

  const admin = createAdminClient();
  if (!(await verifyCurrentPassword(caller.email, password))) {
    await recordAudit(admin, caller.organizationId, caller.id, 'ai.reauth.failed', { operation: 'credential.delete' });
    return { ok: false, error: REAUTH_FAILED_MESSAGE };
  }

  const { data: deleted, error } = await admin
    .from('ai_credentials')
    .delete()
    .eq('organizationId', caller.organizationId)
    .select('provider')
    .maybeSingle();
  if (error) {
    (await getRequestLogger()).error({ error }, 'AI の鍵の削除に失敗しました');
    return { ok: false, error: 'API キーの削除に失敗しました' };
  }
  if (!deleted) {
    return { ok: false, error: '削除する API キーがありません' };
  }

  await recordAudit(admin, caller.organizationId, caller.id, 'ai.credential.delete', {
    provider: deleted.provider as string,
  });
  return { ok: true, data: undefined };
};
