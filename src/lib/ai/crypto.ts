// 画面から登録した API キー（方式B）の暗号化と復号（サーバ専用）。Node 標準の node:crypto を使う（新しい依存は入れない）。
//
// - AES-256-GCM。IV は保存のたびに 12 バイトの乱数で作り直す（同じ IV を使い回すと GCM は破れる）。
// - 追加認証データ（AAD）に組織 ID と提供元を入れる。暗号文を別の組織・別の提供元の行に移しても復号できない。
// - 暗号化の鍵（AI_ENCRYPTION_KEY）は DB の外（環境変数）に置く。DB やバックアップだけが漏れても鍵は読めない。
// - keyId は暗号化の鍵の SHA-256 の先頭 16 文字。暗号化の鍵を替えると一致しなくなるので、
//   復号を試さずに「登録し直してください」と伝えられる（鍵そのものは指紋からは分からない）。
// - pgcrypto や Supabase Vault は使わない（鍵の平文が SQL 文に乗り、DB のログに残りうるため）。

import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AiProviderId } from '@/types/ai';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const AUTH_TAG_BYTES = 16;

export interface EncryptedApiKey {
  /** base64 */
  ciphertext: string;
  /** base64（12 バイト） */
  iv: string;
  /** base64（16 バイト） */
  authTag: string;
}

/** AI_ENCRYPTION_KEY（base64）を 32 バイトの鍵にする。形が違えば null */
export const parseEncryptionKey = (value: string | undefined): Buffer | null => {
  const trimmed = value?.trim();
  if (!trimmed || !/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed, 'base64');
  return key.length === KEY_BYTES ? key : null;
};

/** 暗号化の鍵の指紋（SHA-256 の先頭 16 文字）。暗号化の鍵を替えたことを見分けるために保存する */
export const encryptionKeyId = (key: Buffer): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 16);

/** 追加認証データ。暗号文をこの組織・この提供元の行に結びつける */
export const credentialAad = (organizationId: string, provider: AiProviderId): string =>
  `ai-credential:v1:${organizationId}:${provider}`;

export const encryptApiKey = (apiKey: string, key: Buffer, aad: string): EncryptedApiKey => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
};

/** 復号する。書き換えられた・別の行の・別の暗号化の鍵の暗号文なら null（例外は投げない） */
export const decryptApiKey = (encrypted: EncryptedApiKey, key: Buffer, aad: string): string | null => {
  try {
    const iv = Buffer.from(encrypted.iv, 'base64');
    const authTag = Buffer.from(encrypted.authTag, 'base64');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) return null;
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
};

/** 画面に表示する、鍵の末尾 4 文字 */
export const apiKeyLast4 = (apiKey: string): string => apiKey.slice(-4);
