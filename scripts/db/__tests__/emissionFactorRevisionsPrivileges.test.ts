// 排出係数の変更履歴（emission_factor_revisions と記録トリガー）の権限に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 検証対象: 20261019000000_emission_factor_revisions.sql。
//   履歴は監査用のため、authenticated に書き込み（ポリシーまたは GRANT）が入ると利用者が改ざんできる。
//   記録はトリガー関数（security definer）だけが行い、その関数は /rpc/ から直接呼べないようにする。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261019000000_emission_factor_revisions.sql'),
  'utf8',
);

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy =>
  /\bon emission_factor_revisions\b/.test(policy),
);

const grants = body.match(/grant [^;]*;/g) ?? [];

describe('emission_factor_revisions は authenticated には読み取り専用', () => {
  it('RLS が有効化されている', () => {
    expect(body).toContain('alter table emission_factor_revisions enable row level security;');
  });

  it('ポリシーは select だけ（自組織限定）', () => {
    expect(policies).not.toHaveLength(0);
    for (const policy of policies) {
      expect(policy).toMatch(/for select/);
      expect(policy).toMatch(/current_user_organization_id\(\)/);
    }
  });

  it('authenticated への GRANT に insert / update / delete が含まれない', () => {
    const grantsToAuthenticated = grants.filter(
      grant => /\bemission_factor_revisions\b/.test(grant) && /to authenticated;$/.test(grant),
    );
    expect(grantsToAuthenticated).not.toHaveLength(0);
    for (const grant of grantsToAuthenticated) {
      const operations = grant.slice('grant '.length, grant.indexOf(' on '));
      expect(operations).toBe('select');
    }
  });
});

describe('記録トリガー', () => {
  it('トリガー関数は security definer で search_path を空にする（検索パス経由のすり替えを防ぐ）', () => {
    const fn = body.match(/create function record_emission_factor_revision\(\)[^$]*\$\$/)?.[0] ?? '';
    expect(fn).toContain('security definer');
    expect(fn).toContain("set search_path = ''");
  });

  it('トリガー関数の EXECUTE を public / anon / authenticated から外す', () => {
    expect(body).toContain(
      'revoke execute on function record_emission_factor_revision() from public, anon, authenticated;',
    );
  });

  it('組織の係数の係数値・単位が実際に変わったときだけ記録する', () => {
    const trigger = body.match(/create trigger record_emission_factor_revision[^;]*;/)?.[0] ?? '';
    expect(trigger).toContain('after update of "factorValue", unit on emission_factors');
    expect(trigger).toContain('new."organizationId" is not null');
    expect(trigger).toContain('old."factorValue" is distinct from new."factorValue"');
    expect(trigger).toContain('old.unit is distinct from new.unit');
  });
});
