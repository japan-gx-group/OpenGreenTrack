import { describe, expect, it } from 'vitest';
import { isValidAiApiKey, readAiConfig } from '../config';

// テスト用のダミーの鍵。鍵らしい文字列をソースに書くと秘密情報の走査（gitleaks）に当たるため、同じ文字の繰り返しで作る。
const KEY = 'x'.repeat(24);

describe('readAiConfig', () => {
  it('提供元と鍵がそろえば方式A（環境変数）として使える', () => {
    expect(readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY })).toEqual({
      ok: true,
      keySource: 'server',
      provider: 'openai',
      apiKey: KEY,
    });
  });

  it('前後の空白は除く', () => {
    expect(readAiConfig({ AI_PROVIDER: ' google ', AI_API_KEY: ` ${KEY}\n` })).toMatchObject({
      ok: true,
      provider: 'google',
      apiKey: KEY,
    });
  });

  it('どちらかが無ければ未設定（AI を使わない環境）', () => {
    expect(readAiConfig({})).toEqual({ ok: false, problem: 'not_configured' });
    expect(readAiConfig({ AI_PROVIDER: 'anthropic' })).toEqual({ ok: false, problem: 'not_configured' });
    expect(readAiConfig({ AI_API_KEY: KEY })).toEqual({ ok: false, problem: 'not_configured' });
  });

  it('対応していない提供元は使えない側に倒す', () => {
    expect(readAiConfig({ AI_PROVIDER: 'azure', AI_API_KEY: KEY })).toEqual({
      ok: false,
      problem: 'invalid_provider',
    });
  });

  it('鍵の形が不正（途中の空白・改行・短すぎる）なら使えない側に倒す', () => {
    expect(readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-abc def-0123' })).toEqual({
      ok: false,
      problem: 'invalid_key',
    });
    expect(readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'sk-abc\r\nX-Injected: 1' })).toEqual({
      ok: false,
      problem: 'invalid_key',
    });
    expect(readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: 'short' })).toEqual({
      ok: false,
      problem: 'invalid_key',
    });
  });

  it('AI_ALLOW_KEY_REGISTRATION は true / false 以外なら使えない側に倒す', () => {
    expect(
      readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY, AI_ALLOW_KEY_REGISTRATION: 'yes' }),
    ).toEqual({ ok: false, problem: 'invalid_registration_flag' });
    expect(
      readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY, AI_ALLOW_KEY_REGISTRATION: 'false' }),
    ).toMatchObject({ ok: true, keySource: 'server' });
  });
});

describe('isValidAiApiKey', () => {
  it('先頭の文字では判定しない（提供元が鍵の形を変えることがあるため）', () => {
    expect(isValidAiApiKey('AIzaSyD-example_KEY.0123')).toBe(true);
    expect(isValidAiApiKey('some-new-format-key-0001')).toBe(true);
  });

  it('512 文字を超える鍵は受け付けない', () => {
    expect(isValidAiApiKey('a'.repeat(512))).toBe(true);
    expect(isValidAiApiKey('a'.repeat(513))).toBe(false);
  });
});

describe('readAiConfig（方式B: 画面からの登録）', () => {
  // 暗号化の鍵もテストでは同じ値の繰り返しで作る（鍵らしい文字列をソースに書かない）。
  const ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

  it('暗号化の鍵がそろえば方式B。提供元は既定で 3 社すべて、AI_PROVIDER・AI_API_KEY は読まない', () => {
    const config = readAiConfig({ AI_ALLOW_KEY_REGISTRATION: 'true', AI_ENCRYPTION_KEY: ENCRYPTION_KEY });
    expect(config).toMatchObject({
      ok: true,
      keySource: 'app',
      allowedProviders: ['anthropic', 'google', 'openai'],
      ignoresServerKey: false,
    });
    expect(config.ok && config.keySource === 'app' && config.encryptionKeyId).toMatch(/^[0-9a-f]{16}$/);

    expect(
      readAiConfig({ AI_ALLOW_KEY_REGISTRATION: 'true', AI_ENCRYPTION_KEY: ENCRYPTION_KEY, AI_API_KEY: KEY }),
    ).toMatchObject({ ok: true, keySource: 'app', ignoresServerKey: true });
  });

  it('暗号化の鍵が無い・32 バイトでない・base64 でないなら、暗号化せずに保存する方向へは倒さず使えない状態にする', () => {
    for (const key of [undefined, '', Buffer.alloc(16, 1).toString('base64'), 'not base64!!']) {
      expect(readAiConfig({ AI_ALLOW_KEY_REGISTRATION: 'true', AI_ENCRYPTION_KEY: key })).toEqual({
        ok: false,
        problem: 'invalid_encryption_key',
      });
    }
  });

  it('AI_ALLOWED_PROVIDERS で登録してよい提供元を絞れる。対応していない名前があれば使えない状態にする', () => {
    expect(
      readAiConfig({ AI_ALLOW_KEY_REGISTRATION: 'true', AI_ENCRYPTION_KEY: ENCRYPTION_KEY, AI_ALLOWED_PROVIDERS: ' openai, anthropic ' }),
    ).toMatchObject({ ok: true, allowedProviders: ['anthropic', 'openai'] });
    expect(
      readAiConfig({ AI_ALLOW_KEY_REGISTRATION: 'true', AI_ENCRYPTION_KEY: ENCRYPTION_KEY, AI_ALLOWED_PROVIDERS: 'openai,azure' }),
    ).toEqual({ ok: false, problem: 'invalid_allowed_providers' });
  });
});
