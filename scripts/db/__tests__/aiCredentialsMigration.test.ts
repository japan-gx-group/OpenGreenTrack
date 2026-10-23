// 画面から登録した AI の API キー（20261024180000_ai_credentials.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// - ai_credentials は暗号文・IV・タグ・暗号化の鍵の指紋・末尾 4 文字だけを持ち、平文の鍵の列を持たない
// - RLS を有効にしてポリシーを置かず、anon・authenticated の権限をすべて外す（ブラウザ側からは一切読めない）
// - 読み書きは service_role だけ

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261024180000_ai_credentials.sql'),
  'utf8',
);

const body = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

describe('ai_credentials', () => {
  it('1 組織 = 1 行で、組織の削除で消える', () => {
    expect(body).toContain('"organizationId" uuid primary key references organizations(id) on delete cascade');
  });

  it('暗号文・IV・タグ・指紋・末尾 4 文字だけを持ち、平文の鍵の列を持たない', () => {
    for (const column of ['ciphertext text not null', 'iv text not null', '"authTag" text not null', '"keyId" varchar(16) not null', '"keyLast4" varchar(4) not null']) {
      expect(body).toContain(column);
    }
    expect(body).not.toMatch(/"?api_?key"?\s+(text|varchar)/i);
  });

  it('提供元は anthropic / google / openai だけ', () => {
    expect(body).toContain("check (provider in ('anthropic', 'google', 'openai'))");
  });

  it('RLS を有効にし、ポリシーを 1 つも置かない', () => {
    expect(body).toContain('alter table ai_credentials enable row level security;');
    expect(body).not.toMatch(/create policy/);
  });

  it('anon・authenticated の権限をすべて外し、読み書きは service_role だけに与える', () => {
    expect(body).toContain('revoke all on ai_credentials from anon, authenticated;');
    expect(body).toContain('grant select, insert, update, delete on ai_credentials to service_role;');
    expect(body).not.toMatch(/grant [^;]* on ai_credentials to (anon|authenticated)/);
  });
});
