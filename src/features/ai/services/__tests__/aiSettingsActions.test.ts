import { beforeEach, describe, expect, it, vi } from 'vitest';

// saveAiModel（Server Action）の検証。管理者の確認・モデル ID の検証・一覧との突き合わせ・保存・監査ログを確かめる。

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  listAvailableModels: vi.fn(),
  previous: null as null | { provider: string; modelId: string },
  upserts: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
  touchedDb: false,
}));

vi.mock('@/lib/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz')>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/ai/models', () => ({ listAvailableModels: mocks.listAvailableModels }));
vi.mock('@/lib/logging/requestLogger', () => ({
  getRequestLogger: async () => ({ warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    mocks.touchedDb = true;
    return {
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
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.previous, error: null }) }) }),
          upsert: async (row: Record<string, unknown>) => {
            mocks.upserts.push(row);
            return { error: null };
          },
        };
      },
    };
  },
}));

import { saveAiModel } from '../aiSettingsActions';

const admin = { id: 'admin-1', organizationId: 'org-1', email: 'a@example.com', fullName: null, role: 'admin' };
const listed = {
  ok: true,
  provider: 'anthropic',
  models: [
    { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', createdAt: null, deprecated: false, retiresOn: null },
    { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', createdAt: null, deprecated: false, retiresOn: null },
  ],
};

describe('saveAiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.previous = { provider: 'anthropic', modelId: 'claude-haiku-5-5' };
    mocks.upserts = [];
    mocks.audits = [];
    mocks.touchedDb = false;
    mocks.requireAdmin.mockResolvedValue({ ok: true, profile: admin });
    mocks.listAvailableModels.mockResolvedValue(listed);
  });

  it('管理者でなければ、一覧も DB にも触れずに断る', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, error: '管理者のみ操作できます' });
    const result = await saveAiModel('claude-sonnet-5-5');
    expect(result).toEqual({ ok: false, error: '管理者のみ操作できます' });
    expect(mocks.listAvailableModels).not.toHaveBeenCalled();
    expect(mocks.touchedDb).toBe(false);
  });

  it('形が不正なモデル ID は断る（URL のパスに入るため）', async () => {
    for (const id of ['../../v1/files', 'gemini-2.5-flash:generateContent', 'a b', '']) {
      const result = await saveAiModel(id);
      expect(result).toEqual({ ok: false, error: 'モデルの ID が正しくありません' });
    }
    expect(mocks.listAvailableModels).not.toHaveBeenCalled();
  });

  it('提供元の一覧に無いモデルは保存しない', async () => {
    const result = await saveAiModel('claude-not-in-list');
    expect(result.ok).toBe(false);
    expect(mocks.upserts).toEqual([]);
  });

  it('一覧にあれば保存し、変更前と変更後を監査ログに残す', async () => {
    const result = await saveAiModel('claude-sonnet-5-5');
    expect(result).toEqual({ ok: true, data: { modelId: 'claude-sonnet-5-5' } });
    expect(mocks.upserts[0]).toMatchObject({
      organizationId: 'org-1',
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      updatedBy: 'admin-1',
    });
    expect(mocks.audits).toEqual([
      {
        organizationId: 'org-1',
        userId: 'admin-1',
        action: 'ai.model.update',
        entityName: 'ai_settings',
        detail: JSON.stringify({
          provider: 'anthropic',
          modelId: 'claude-sonnet-5-5',
          previousProvider: 'anthropic',
          previousModelId: 'claude-haiku-5-5',
        }),
      },
    ]);
  });

  it('同じモデルを保存し直しても、書き込みも記録もしない', async () => {
    const result = await saveAiModel('claude-haiku-5-5');
    expect(result.ok).toBe(true);
    expect(mocks.upserts).toEqual([]);
    expect(mocks.audits).toEqual([]);
  });

  it('一覧を取れなければ、その理由の文を返して保存しない', async () => {
    mocks.listAvailableModels.mockResolvedValue({ ok: false, status: 503, error: 'AI はまだ使えません', reason: 'not_configured' });
    const result = await saveAiModel('claude-sonnet-5-5');
    expect(result).toEqual({ ok: false, error: 'AI はまだ使えません' });
    expect(mocks.upserts).toEqual([]);
  });
});
