// API キーの取り出し（サーバ専用）。方式A（環境変数）と方式B（DB の暗号文を復号）のどちらでも、同じ形で返す。
// 共通の入口（generate.ts）とモデル一覧（models.ts）はこれだけを使い、方式の違いを知らずに済むようにする。
//
// 方式B の鍵は ai_credentials（authenticated からは読めない）にあり、service_role で読む。組織は呼び出し側が
// ログイン情報から取った organizationId に限る。復号した鍵は呼び出しの間だけ使い、どこにも保存しない。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isAiProviderId, type AiProviderId } from '@/types/ai';
import { readAiConfig, type AiConfigProblem } from './config';
import { credentialAad, decryptApiKey } from './crypto';

export type AiCredentialProblem =
  | AiConfigProblem
  /** 方式B で、まだ鍵が登録されていない */
  | 'credential_missing'
  /** 方式B で、暗号化の鍵を替えた・暗号文が壊れているため復号できない（登録し直す） */
  | 'credential_unreadable'
  /** 方式B で、登録した鍵の提供元が今は許可されていない（AI_ALLOWED_PROVIDERS を狭めた） */
  | 'credential_provider_not_allowed'
  /** DB から読めなかった */
  | 'credential_read_failed';

export type AiCredential =
  | { ok: true; keySource: 'server' | 'app'; provider: AiProviderId; apiKey: string }
  | { ok: false; problem: AiCredentialProblem };

export const resolveAiCredential = async (
  admin: SupabaseClient,
  organizationId: string,
): Promise<AiCredential> => {
  const config = readAiConfig();
  if (!config.ok) return { ok: false, problem: config.problem };
  if (config.keySource === 'server') {
    return { ok: true, keySource: 'server', provider: config.provider, apiKey: config.apiKey };
  }

  const { data, error } = await admin
    .from('ai_credentials')
    .select('provider, ciphertext, iv, authTag, keyId')
    .eq('organizationId', organizationId)
    .maybeSingle();
  if (error) return { ok: false, problem: 'credential_read_failed' };
  if (!data) return { ok: false, problem: 'credential_missing' };

  const provider = data.provider as unknown;
  if (!isAiProviderId(provider) || !config.allowedProviders.includes(provider)) {
    return { ok: false, problem: 'credential_provider_not_allowed' };
  }
  // 暗号化の鍵を替えていれば、復号を試さずに登録し直してもらう。
  if (data.keyId !== config.encryptionKeyId) {
    return { ok: false, problem: 'credential_unreadable' };
  }
  const apiKey = decryptApiKey(
    { ciphertext: data.ciphertext as string, iv: data.iv as string, authTag: data.authTag as string },
    config.encryptionKey,
    credentialAad(organizationId, provider),
  );
  if (apiKey === null) return { ok: false, problem: 'credential_unreadable' };
  return { ok: true, keySource: 'app', provider, apiKey };
};
