import { describe, expect, it } from 'vitest';
import {
  apiKeyLast4,
  credentialAad,
  decryptApiKey,
  encryptApiKey,
  encryptionKeyId,
  parseEncryptionKey,
} from '../crypto';

// テストの鍵は同じ値の繰り返しで作る（鍵らしい文字列をソースに書くと gitleaks に当たるため）。
const KEY_A = Buffer.alloc(32, 1);
const KEY_B = Buffer.alloc(32, 2);
const API_KEY = 'x'.repeat(40);
const AAD = credentialAad('org-1', 'anthropic');

describe('parseEncryptionKey', () => {
  it('32 バイトの base64 だけを受け付ける', () => {
    expect(parseEncryptionKey(KEY_A.toString('base64'))?.equals(KEY_A)).toBe(true);
    expect(parseEncryptionKey(` ${KEY_A.toString('base64')}\n`)?.equals(KEY_A)).toBe(true);
    expect(parseEncryptionKey(Buffer.alloc(31, 1).toString('base64'))).toBeNull();
    expect(parseEncryptionKey(Buffer.alloc(33, 1).toString('base64'))).toBeNull();
    expect(parseEncryptionKey('これは base64 ではない')).toBeNull();
    expect(parseEncryptionKey(undefined)).toBeNull();
  });
});

describe('encryptApiKey / decryptApiKey', () => {
  it('暗号化して復号すると元に戻る。暗号文に鍵がそのまま入らない', () => {
    const encrypted = encryptApiKey(API_KEY, KEY_A, AAD);
    expect(decryptApiKey(encrypted, KEY_A, AAD)).toBe(API_KEY);
    expect(JSON.stringify(encrypted)).not.toContain(API_KEY);
    expect(Buffer.from(encrypted.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(encrypted.authTag, 'base64')).toHaveLength(16);
  });

  it('保存のたびに IV を作り直す（同じ鍵でも暗号文が毎回変わる）', () => {
    const first = encryptApiKey(API_KEY, KEY_A, AAD);
    const second = encryptApiKey(API_KEY, KEY_A, AAD);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('暗号文・IV・タグのどれかを書き換えると復号できない', () => {
    const encrypted = encryptApiKey(API_KEY, KEY_A, AAD);
    const flip = (base64: string) => {
      const bytes = Buffer.from(base64, 'base64');
      bytes[0] ^= 0xff;
      return bytes.toString('base64');
    };
    expect(decryptApiKey({ ...encrypted, ciphertext: flip(encrypted.ciphertext) }, KEY_A, AAD)).toBeNull();
    expect(decryptApiKey({ ...encrypted, iv: flip(encrypted.iv) }, KEY_A, AAD)).toBeNull();
    expect(decryptApiKey({ ...encrypted, authTag: flip(encrypted.authTag) }, KEY_A, AAD)).toBeNull();
  });

  it('別の組織・別の提供元の行に移した暗号文は復号できない（追加認証データ）', () => {
    const encrypted = encryptApiKey(API_KEY, KEY_A, AAD);
    expect(decryptApiKey(encrypted, KEY_A, credentialAad('org-2', 'anthropic'))).toBeNull();
    expect(decryptApiKey(encrypted, KEY_A, credentialAad('org-1', 'openai'))).toBeNull();
  });

  it('暗号化の鍵を替えると復号できず、指紋（keyId）も変わる', () => {
    const encrypted = encryptApiKey(API_KEY, KEY_A, AAD);
    expect(decryptApiKey(encrypted, KEY_B, AAD)).toBeNull();
    expect(encryptionKeyId(KEY_A)).toMatch(/^[0-9a-f]{16}$/);
    expect(encryptionKeyId(KEY_A)).not.toBe(encryptionKeyId(KEY_B));
  });

  it('形の崩れた暗号文でも例外を投げず null を返す', () => {
    expect(decryptApiKey({ ciphertext: '', iv: '', authTag: '' }, KEY_A, AAD)).toBeNull();
  });
});

describe('apiKeyLast4', () => {
  it('画面に出すのは末尾 4 文字だけ', () => {
    expect(apiKeyLast4(`${'x'.repeat(20)}a1b2`)).toBe('a1b2');
  });
});
