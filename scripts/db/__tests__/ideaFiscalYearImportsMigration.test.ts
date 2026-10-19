// IDEA の版の年度割り当て（20261019120000_idea_fiscal_year_imports.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// - idea_fiscal_year_imports は authenticated には自組織の読み取りだけ（書き込みは service_role 限定の RPC）
// - 取込完了（complete_idea_import）の付け替え・孤児化は、版を割り当てた年度の活動量を対象から除く
//   （除かないと、割り当てた版を参照している活動量まで新しい版へ付け替わる・参照を外される）
// - 割り当て中の版は削除できない（delete_idea_import が P2033 で止める）
// - 置き換えた RPC の EXECUTE は service_role 限定のまま

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261019120000_idea_fiscal_year_imports.sql'),
  'utf8',
);

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = migrationSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

/** 関数定義（create … function name(…) … $$;）を取り出す */
const functionBody = (name: string): string => {
  const match = body.match(new RegExp(`create (or replace )?function ${name}\\(.*?\\$\\$;`));
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
};

const excludesAssignedYears =
  /not exists \( select 1 from idea_fiscal_year_imports m join fiscal_years fy on fy\.id = m\."fiscalYearId" where m\."organizationId" = p_organization_id and ar\."periodStart" between fy\."startDate" and fy\."endDate" \)/g;

describe('idea_fiscal_year_imports の権限', () => {
  it('RLS を有効化し、ポリシーは自組織の select だけ', () => {
    expect(body).toContain('alter table idea_fiscal_year_imports enable row level security;');
    const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy => /on idea_fiscal_year_imports/.test(policy));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select/);
    expect(policies[0]).toMatch(/current_user_organization_id\(\)/);
  });

  it('authenticated への GRANT は select だけ', () => {
    expect(body).toContain('grant select on idea_fiscal_year_imports to authenticated;');
    expect(body).not.toMatch(/grant [^;]*(insert|update|delete)[^;]* on idea_fiscal_year_imports to authenticated/);
  });

  it('割り当て中の版は FK でも消せない（on delete restrict）', () => {
    expect(body).toMatch(/"importId" uuid not null references idea_imports\(id\) on delete restrict/);
  });
});

describe('RPC', () => {
  it('assign_idea_import_to_fiscal_year は年度・版の組織を突き合わせ、取込が完了した版だけを割り当てる', () => {
    const fn = functionBody('assign_idea_import_to_fiscal_year');
    expect(fn).toMatch(/from fiscal_years where id = p_fiscal_year_id and "organizationId" = p_organization_id/);
    expect(fn).toMatch(/from idea_imports where id = p_import_id and "organizationId" = p_organization_id/);
    expect(fn).toMatch(/v_status <> 'completed'/);
    // 付け替え・孤児化はその年度の未算定の活動量だけ
    expect(fn.match(/ar\."periodStart" between v_fy_start and v_fy_end/g)).toHaveLength(2);
    expect(fn.match(/ar\."isCalculated" = false/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('complete_idea_import は付け替えと孤児化の両方で、版を割り当てた年度の活動量を除く', () => {
    const fn = functionBody('complete_idea_import');
    expect(fn.match(excludesAssignedYears)).toHaveLength(2);
  });

  it('delete_idea_import は割り当て中の版を P2033 で止める', () => {
    const fn = functionBody('delete_idea_import');
    expect(fn).toMatch(/from idea_fiscal_year_imports where "importId" = p_import_id/);
    expect(fn).toMatch(/errcode = 'P2033'/);
  });

  it.each([
    'assign_idea_import_to_fiscal_year(uuid, uuid, uuid, uuid)',
    'complete_idea_import(uuid, uuid)',
    'delete_idea_import(uuid, uuid)',
  ])('%s の EXECUTE は service_role 限定', (signature) => {
    expect(body).toContain(`revoke execute on function ${signature} from public, anon, authenticated;`);
    expect(body).toContain(`grant execute on function ${signature} to service_role;`);
  });
});
