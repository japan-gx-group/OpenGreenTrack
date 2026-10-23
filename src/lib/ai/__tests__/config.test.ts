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

  it('画面からの鍵の登録（方式B）はまだ使えないので、true を指定されたら使えない側に倒す', () => {
    expect(
      readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY, AI_ALLOW_KEY_REGISTRATION: 'true' }),
    ).toEqual({ ok: false, problem: 'registration_not_supported' });
    expect(
      readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY, AI_ALLOW_KEY_REGISTRATION: 'yes' }),
    ).toEqual({ ok: false, problem: 'invalid_registration_flag' });
    expect(
      readAiConfig({ AI_PROVIDER: 'openai', AI_API_KEY: KEY, AI_ALLOW_KEY_REGISTRATION: 'false' }),
    ).toMatchObject({ ok: true });
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
