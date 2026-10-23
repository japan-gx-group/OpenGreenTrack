import { describe, expect, it } from 'vitest';
import type { AiConfig } from '../config';
import { buildAiStatus } from '../status';

const appConfig = (overrides: Partial<Extract<AiConfig, { keySource: 'app' }>> = {}): AiConfig => ({
  ok: true,
  keySource: 'app',
  encryptionKey: Buffer.alloc(32, 1),
  encryptionKeyId: 'aaaaaaaaaaaaaaaa',
  allowedProviders: ['anthropic', 'openai'],
  ignoresServerKey: false,
  ...overrides,
});

const credential = (overrides: Record<string, string> = {}) => ({
  provider: 'openai',
  keyId: 'aaaaaaaaaaaaaaaa',
  keyLast4: 'a1b2',
  updatedAt: '2026-10-24T01:00:00Z',
  ...overrides,
});

describe('buildAiStatus', () => {
  it('方式B で登録済み・復号できる鍵なら使える状態で、末尾 4 文字と更新日時を返す', () => {
    expect(
      buildAiStatus({
        config: appConfig(),
        credential: credential(),
        settings: { provider: 'openai', modelId: 'gpt-5' },
        canManage: true,
      }),
    ).toEqual({
      keySource: 'app',
      configured: true,
      provider: 'openai',
      modelId: 'gpt-5',
      canManage: true,
      allowedProviders: ['anthropic', 'openai'],
      registeredKey: { provider: 'openai', last4: 'a1b2', updatedAt: '2026-10-24T01:00:00Z' },
      needsReRegistration: false,
      leftoverKey: false,
    });
  });

  it('方式B で未登録なら使えない状態（登録し直しではない）', () => {
    expect(buildAiStatus({ config: appConfig(), credential: null, settings: null, canManage: true })).toMatchObject({
      keySource: 'app',
      configured: false,
      provider: null,
      registeredKey: null,
      needsReRegistration: false,
    });
  });

  it('方式B で暗号化の鍵を替えた・提供元が許可されなくなったら、登録し直しが必要', () => {
    const changedKey = buildAiStatus({
      config: appConfig(),
      credential: credential({ keyId: 'bbbbbbbbbbbbbbbb' }),
      settings: { provider: 'openai', modelId: 'gpt-5' },
      canManage: false,
    });
    expect(changedKey).toMatchObject({ configured: false, provider: null, modelId: null, needsReRegistration: true });

    const notAllowed = buildAiStatus({
      config: appConfig({ allowedProviders: ['anthropic'] }),
      credential: credential(),
      settings: null,
      canManage: false,
    });
    expect(notAllowed).toMatchObject({ configured: false, needsReRegistration: true });
  });

  it('方式A では、DB に残った鍵を leftoverKey として知らせる', () => {
    const config: AiConfig = { ok: true, keySource: 'server', provider: 'anthropic', apiKey: 'x'.repeat(24) };
    expect(buildAiStatus({ config, credential: credential(), settings: null, canManage: true })).toMatchObject({
      keySource: 'server',
      configured: true,
      provider: 'anthropic',
      leftoverKey: true,
      registeredKey: null,
    });
  });

  it('設定が足りなければ使えない状態', () => {
    expect(
      buildAiStatus({ config: { ok: false, problem: 'invalid_encryption_key' }, credential: null, settings: null, canManage: true }),
    ).toMatchObject({ configured: false, provider: null });
  });
});
