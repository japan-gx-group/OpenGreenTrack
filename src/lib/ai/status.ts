// AI の設定の状態（GET /api/ai/status の応答）を組み立てる純関数（サーバ専用）。Route Handler とテストで共有する。
// 鍵の値・暗号文は受け取らない（登録した鍵の行からは、提供元・指紋・末尾 4 文字・更新日時だけを使う）。

import 'server-only';
import { isAiProviderId, type AiStatus } from '@/types/ai';
import type { AiConfig } from './config';

export interface CredentialMetadata {
  provider: string;
  keyId: string;
  keyLast4: string;
  updatedAt: string;
}

export interface SettingsRow {
  provider: string;
  modelId: string;
}

export const buildAiStatus = ({
  config,
  credential,
  settings,
  canManage,
}: {
  config: AiConfig;
  credential: CredentialMetadata | null;
  settings: SettingsRow | null;
  canManage: boolean;
}): AiStatus => {
  const base: AiStatus = {
    keySource: config.ok ? config.keySource : 'server',
    configured: false,
    provider: null,
    modelId: null,
    canManage,
    allowedProviders: [],
    registeredKey: null,
    needsReRegistration: false,
    leftoverKey: false,
  };
  // 選んだ時点の提供元が今の提供元と同じときだけ、選択中のモデルとして返す（提供元を替えたら選び直す）。
  const modelFor = (provider: string | null) =>
    provider && settings?.provider === provider ? settings.modelId : null;

  if (!config.ok) return base;

  if (config.keySource === 'server') {
    return {
      ...base,
      configured: true,
      provider: config.provider,
      modelId: modelFor(config.provider),
      // 方式B から方式A に戻した後に残った鍵（後で方式B に戻すと、古い鍵がまた使われるため消してもらう）。
      leftoverKey: credential !== null,
    };
  }

  const registeredProvider = credential && isAiProviderId(credential.provider) ? credential.provider : null;
  const registeredKey =
    credential && registeredProvider
      ? { provider: registeredProvider, last4: credential.keyLast4, updatedAt: credential.updatedAt }
      : null;
  const usable =
    registeredKey !== null &&
    credential?.keyId === config.encryptionKeyId &&
    config.allowedProviders.includes(registeredKey.provider);

  return {
    ...base,
    configured: usable,
    provider: usable ? registeredKey.provider : null,
    modelId: usable ? modelFor(registeredKey.provider) : null,
    allowedProviders: config.allowedProviders,
    registeredKey,
    needsReRegistration: credential !== null && !usable,
  };
};
