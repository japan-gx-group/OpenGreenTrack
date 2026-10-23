import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 方式B の鍵の登録・削除（Server Action）の検証。管理者の確認・方式・本人確認・鍵の確認・暗号化・監査ログを確かめる。
// 暗号化は実物を通し、DB・本人確認・モデル一覧・ログイン情報はモックする。
// テストの鍵は同じ値の繰り返しで作る（鍵らしい文字列をソースに書くと gitleaks に当たるため）。

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  verifyCurrentPassword: vi.fn(),
  listModelsWithKey: vi.fn(),
  upserts: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  deleted: null as null | { provider: string },
  existing: null as null | { provider: string },
}));

vi.mock('@/lib/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz')>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/reauth', () => ({ verifyCurrentPassword: mocks.verifyCurrentPassword }));
vi.mock('@/lib/ai/models', () => ({ listModelsWithKey: mocks.listModelsWithKey }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'system_audit_logs') {
        return {
          insert: async (row: Record<string, unknown>) => {
            mocks.audits.push(row);
            return { error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.existing, error: null }) }) }),
        upsert: async (row: Record<string, unknown>) => {
          mocks.upserts.push(row);
          return { error: null };
        },
        delete: () => ({
          eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: mocks.deleted, error: null }) }) }),
        }),
      };
    },
  }),
}));

import { credentialAad, decryptApiKey, encryptionKeyId } from '@/lib/ai/crypto';
import { deleteAiCredential, saveAiCredential } from '../aiCredentialActions';

const ENCRYPTION_KEY = Buffer.alloc(32, 5);
const API_KEY = `${'x'.repeat(28)}wxyz`;
const PASSWORD = 'login-password-for-test';
const admin = { id: 'admin-1', organizationId: 'org-1', email: 'a@example.com', fullName: null, role: 'admin' };
const input = { provider: 'openai' as const, apiKey: API_KEY, password: PASSWORD };

describe('saveAiCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upserts = [];
    mocks.audits = [];
    mocks.existing = null;
    vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', 'true');
    vi.stubEnv('AI_ENCRYPTION_KEY', ENCRYPTION_KEY.toString('base64'));
    vi.stubEnv('AI_ALLOWED_PROVIDERS', 'anthropic,openai');
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: admin });
    mocks.verifyCurrentPassword.mockResolvedValue(true);
    mocks.listModelsWithKey.mockResolvedValue({ ok: true, provider: 'openai', models: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('管理者でなければ、本人確認にも DB にも進まない', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    await expect(saveAiCredential(input)).resolves.toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
    expect(mocks.upserts).toEqual([]);
  });

  it('方式A では、画面から登録できない（直接呼ばれても断る）', async () => {
    vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', '');
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('AI_API_KEY', 'x'.repeat(24));
    await expect(saveAiCredential(input)).resolves.toEqual({
      ok: false,
      error: '画面からの API キーの登録は有効になっていません',
    });
    expect(mocks.upserts).toEqual([]);
  });

  it('許可されていない提供元・形の崩れた鍵・パスワードの未入力は断る', async () => {
    await expect(saveAiCredential({ ...input, provider: 'google' })).resolves.toMatchObject({ ok: false });
    await expect(saveAiCredential({ ...input, apiKey: 'short' })).resolves.toMatchObject({ ok: false });
    await expect(saveAiCredential({ ...input, apiKey: `${API_KEY}\nX-Injected: 1` })).resolves.toMatchObject({ ok: false });
    await expect(saveAiCredential({ ...input, password: '' })).resolves.toMatchObject({ ok: false });
    expect(mocks.verifyCurrentPassword).not.toHaveBeenCalled();
    expect(mocks.upserts).toEqual([]);
  });

  it('本人確認に失敗したら保存せず、ai.reauth.failed を残す', async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false);
    await expect(saveAiCredential(input)).resolves.toEqual({ ok: false, error: 'ログインパスワードが正しくありません' });
    expect(mocks.verifyCurrentPassword).toHaveBeenCalledWith('a@example.com', PASSWORD);
    expect(mocks.upserts).toEqual([]);
    expect(mocks.audits).toEqual([
      expect.objectContaining({ action: 'ai.reauth.failed', detail: JSON.stringify({ operation: 'credential.update' }) }),
    ]);
    expect(mocks.listModelsWithKey).not.toHaveBeenCalled();
  });

  it('提供元に受け付けられない鍵は保存しない', async () => {
    mocks.listModelsWithKey.mockResolvedValue({ ok: false, status: 502, error: '...', reason: 'invalid_key' });
    const result = await saveAiCredential(input);
    expect(result).toMatchObject({ ok: false });
    expect(mocks.upserts).toEqual([]);
  });

  it('暗号化して保存し、監査ログには提供元と末尾 4 文字だけを残す。鍵・パスワードはどこにも出さない', async () => {
    mocks.existing = { provider: 'anthropic' };
    const result = await saveAiCredential(input);
    expect(result).toEqual({ ok: true, data: { provider: 'openai', last4: 'wxyz' } });

    const row = mocks.upserts[0] as Record<string, string>;
    expect(row).toMatchObject({
      organizationId: 'org-1',
      provider: 'openai',
      keyId: encryptionKeyId(ENCRYPTION_KEY),
      keyLast4: 'wxyz',
      updatedBy: 'admin-1',
    });
    // 保存したのは暗号文で、この組織・この提供元として復号すると元の鍵に戻る
    expect(JSON.stringify(row)).not.toContain(API_KEY);
    expect(
      decryptApiKey({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }, ENCRYPTION_KEY, credentialAad('org-1', 'openai')),
    ).toBe(API_KEY);

    expect(mocks.audits).toEqual([
      {
        organizationId: 'org-1',
        userId: 'admin-1',
        action: 'ai.credential.update',
        entityName: 'ai_credentials',
        detail: JSON.stringify({ provider: 'openai', last4: 'wxyz', previousProvider: 'anthropic' }),
      },
    ]);
    const everything = JSON.stringify([result, mocks.audits]);
    expect(everything).not.toContain(API_KEY);
    expect(everything).not.toContain(PASSWORD);
  });
});

describe('deleteAiCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.audits = [];
    mocks.deleted = { provider: 'openai' };
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: admin });
    mocks.verifyCurrentPassword.mockResolvedValue(true);
  });

  it('管理者でなければ断る', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    await expect(deleteAiCredential({ password: PASSWORD })).resolves.toEqual({ ok: false, error: '管理者のみ操作できます' });
  });

  it('本人確認に失敗したら削除せず、ai.reauth.failed を残す', async () => {
    mocks.verifyCurrentPassword.mockResolvedValue(false);
    await expect(deleteAiCredential({ password: PASSWORD })).resolves.toEqual({
      ok: false,
      error: 'ログインパスワードが正しくありません',
    });
    expect(mocks.audits).toEqual([
      expect.objectContaining({ action: 'ai.reauth.failed', detail: JSON.stringify({ operation: 'credential.delete' }) }),
    ]);
  });

  it('方式にかかわらず削除でき（方式A に戻した後の掃除）、ai.credential.delete を残す', async () => {
    vi.stubEnv('AI_ALLOW_KEY_REGISTRATION', '');
    await expect(deleteAiCredential({ password: PASSWORD })).resolves.toEqual({ ok: true, data: undefined });
    expect(mocks.audits).toEqual([
      expect.objectContaining({ action: 'ai.credential.delete', detail: JSON.stringify({ provider: 'openai' }) }),
    ]);
    vi.unstubAllEnvs();
  });

  it('消す鍵が無ければそう伝える', async () => {
    mocks.deleted = null;
    await expect(deleteAiCredential({ password: PASSWORD })).resolves.toEqual({ ok: false, error: '削除する API キーがありません' });
  });
});
