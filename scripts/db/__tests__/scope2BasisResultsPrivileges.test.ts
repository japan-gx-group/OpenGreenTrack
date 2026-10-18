// Scope 2 基準別算定（scope2_basis_results と関連 RPC）の権限に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 検証対象: 20261006000000_scope2_dual_basis.sql。
//   scope2_basis_results に authenticated の書き込み（ポリシーまたは GRANT）が入ると、
//   PostgREST 直叩きで基準別の報告値を算定エンジンを通さず書き換えられる
//   （emission_results / dashboard_aggregates を読み取り専用にしている前提と同じ理由）。
//   また、drop → create で作り直した run_calculation_commit は EXECUTE が PUBLIC 付与に戻るため、
//   revoke → service_role 限定の grant がこのファイル内でやり直されていることを固定する。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261006000000_scope2_dual_basis.sql'),
  'utf8',
);

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

/** `create policy …;` を 1 文ずつ取り出す */
const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy =>
  /\bon scope2_basis_results\b/.test(policy),
);

/** `grant …;` を 1 文ずつ取り出す */
const grants = body.match(/grant [^;]*;/g) ?? [];

describe('scope2_basis_results は authenticated には読み取り専用', () => {
  it('RLS が有効化されている', () => {
    expect(body).toContain('alter table scope2_basis_results enable row level security;');
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
      grant => /\bscope2_basis_results\b/.test(grant) && /to authenticated;$/.test(grant),
    );
    expect(grantsToAuthenticated).not.toHaveLength(0);
    for (const grant of grantsToAuthenticated) {
      const operations = grant.slice('grant '.length, grant.indexOf(' on '));
      expect(operations).toBe('select');
    }
  });
});

describe('run_calculation_commit の作り直しに伴う EXECUTE 権限', () => {
  // drop/create すると PUBLIC に EXECUTE が付与し直されるため、revoke → grant の両方が必須。
  it('PUBLIC・anon・authenticated から revoke されている', () => {
    expect(body).toContain(
      'revoke execute on function run_calculation_commit(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;',
    );
  });

  it('service_role だけに grant されている', () => {
    const executeGrants = grants.filter(grant => /run_calculation_commit/.test(grant));
    expect(executeGrants).toEqual([
      'grant execute on function run_calculation_commit(uuid, uuid, uuid, jsonb, jsonb) to service_role;',
    ]);
  });
});

describe('基準と根拠種別の整合', () => {
  it('check 制約で契約根拠がロケーション基準に付かないことを強制している', () => {
    expect(body).toMatch(
      /check \( \(basis = 'location_based' and evidence = 'grid_average'\) or \(basis = 'market_based' and evidence in \('contract_menu', 'grid_fallback'\)\) \)/,
    );
  });
});
