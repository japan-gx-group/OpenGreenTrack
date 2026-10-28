// AI の設定（20261024150000_ai_settings.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// - ai_settings は 1 組織 = 1 行で、API キーの列を持たない（鍵は環境変数に置く）
// - authenticated には自組織の select だけ（書き込みは管理者を確かめたうえで service_role から）
// - 提供元は 3 社だけ

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261024150000_ai_settings.sql'),
  'utf8',
);

const body = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

describe('ai_settings', () => {
  it('1 組織 = 1 行（organizationId が主キー）で、組織の削除で消える', () => {
    expect(body).toContain('"organizationId" uuid primary key references organizations(id) on delete cascade');
  });

  it('API キーの列を持たない', () => {
    expect(body).not.toMatch(/api_?key|secret|ciphertext/i);
  });

  it('提供元は anthropic / google / openai だけ', () => {
    expect(body).toContain("check (provider in ('anthropic', 'google', 'openai'))");
  });

  it('RLS を有効にし、ポリシーは自組織の select だけ', () => {
    expect(body).toContain('alter table ai_settings enable row level security;');
    const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy => /on ai_settings/.test(policy));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select to authenticated using \("organizationId" = \(select current_user_organization_id\(\)\)\)/);
  });

  it('authenticated への GRANT は select だけ', () => {
    expect(body).toContain('grant select on ai_settings to authenticated;');
    expect(body).not.toMatch(/grant [^;]*(insert|update|delete)[^;]* on ai_settings to authenticated/);
  });
});
