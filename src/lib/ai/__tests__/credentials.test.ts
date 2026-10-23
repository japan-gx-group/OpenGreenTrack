import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { credentialAad, encryptApiKey, encryptionKeyId } from '../crypto';
import { resolveAiCredential } from '../credentials';

// 鍵の取り出し（方式A: 環境変数 / 方式B: DB の暗号文を復号）を確かめる。
// テストの鍵は同じ値の繰り返しで作る（鍵らしい文字列をソースに書くと gitleaks に当たるため）。

const ENCRYPTION_KEY = Buffer.alloc(32, 3);
const API_KEY = 'x'.repeat(30);

const adminWith = (row: unknown, error: unknown = null) => {
  const calls: string[] = [];
  const admin = {
    from: (table: string) => {
      calls.push(table);
      return {
        select: () => ({ eq: (_column: string, value: string) => {
          calls.push(`organizationId=${value}`);
          return { maybeSingle: async () => ({ data: row, error }) };
        } }),
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
};

const registeredRow = (overrides: Record<string, unknown> = {}) => ({
  provider: 'openai',
  ...encryptApiKey(API_KEY, ENCRYPTION_KEY, credentialAad('org-1', 'openai')),
  keyId: encryptionKeyId(ENCRYPTION_KEY),
  ...overrides,
});

describe('resolveAiCredential', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('方式A', () => {
    beforeEach(() => {
      vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', '');
      vi.stubEnv('AI_PROVIDER', 'google');
      vi.stubEnv('AI_API_KEY', API_KEY);
    });

    it('環境変数の鍵を返し、DB は読まない', async () => {
      const { admin, calls } = adminWith(registeredRow());
      await expect(resolveAiCredential(admin, 'org-1')).resolves.toEqual({
        ok: true,
        keySource: 'server',
        provider: 'google',
        apiKey: API_KEY,
      });
      expect(calls).toEqual([]);
    });
  });

  describe('方式B', () => {
    beforeEach(() => {
      vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', 'true');
      vi.stubEnv('AI_ENCRYPTION_KEY', ENCRYPTION_KEY.toString('base64'));
      vi.stubEnv('AI_ALLOWED_PROVIDERS', '');
      vi.stubEnv('AI_API_KEY', '');
    });

    it('自組織の行を読んで復号する', async () => {
      const { admin, calls } = adminWith(registeredRow());
      await expect(resolveAiCredential(admin, 'org-1')).resolves.toEqual({
        ok: true,
        keySource: 'app',
        provider: 'openai',
        apiKey: API_KEY,
      });
      expect(calls).toEqual(['ai_credentials', 'organizationId=org-1']);
    });

    it('未登録なら credential_missing', async () => {
      const { admin } = adminWith(null);
      await expect(resolveAiCredential(admin, 'org-1')).resolves.toEqual({ ok: false, problem: 'credential_missing' });
    });

    it('暗号化の鍵を替えた（指紋が違う）なら、復号を試さずに credential_unreadable', async () => {
      const { admin } = adminWith(registeredRow({ keyId: encryptionKeyId(Buffer.alloc(32, 9)) }));
      await expect(resolveAiCredential(admin, 'org-1')).resolves.toEqual({ ok: false, problem: 'credential_unreadable' });
    });

    it('別の組織の行の暗号文は復号できない（credential_unreadable）', async () => {
      const { admin } = adminWith(registeredRow());
      await expect(resolveAiCredential(admin, 'org-2')).resolves.toEqual({ ok: false, problem: 'credential_unreadable' });
    });

    it('登録した提供元が今は許可されていなければ使わない', async () => {
      vi.stubEnv('AI_ALLOWED_PROVIDERS', 'anthropic');
      const { admin } = adminWith(registeredRow());
      await expect(resolveAiCredential(admin, 'org-1')).resolves.toEqual({
        ok: false,
        problem: 'credential_provider_not_allowed',
      });
    });

    it('DB から読めなければ credential_read_failed', async () => {
      const { admin } = adminWith(null, { message: 'boom' });
      await expect(resolveAiCredential(admin, 'org-1')).resolves.toEqual({ ok: false, problem: 'credential_read_failed' });
    });
  });
});
