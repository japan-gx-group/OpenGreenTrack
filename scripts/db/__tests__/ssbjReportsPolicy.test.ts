// SSBJ レポート（ssbj_reports）の RLS・権限に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - 組織分離: select / insert / update がすべて自組織に限定されている
//   - 年度の組織帰属: insert / update の with check が fiscal_years を exists で検証している
//     （FK は行の存在しか見ないため、落とすと他組織の年度に結び付いたレポートを作れてしまう）
//   - R1 では削除を提供しない: delete のポリシーも GRANT も無い
//   - 作成後に組織・年度を付け替えられない: update の列 GRANT に organizationId / fiscalYearId が無い
//   - 年度削除でレポートが連鎖削除されない: fiscalYearId の FK に on delete cascade が無い

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_reports.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_reports のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = body.match(/create policy[^;]*;/g) ?? [];
const grants = body.match(/grant [^;]*;/g) ?? [];

const policyFor = (command: string): string => {
  const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
  if (!policy) throw new Error(`${command} のポリシーがありません`);
  return policy;
};

const FISCAL_YEAR_CHECK =
  /exists \( select 1 from fiscal_years fy where fy\.id = "fiscalYearId" and fy\."organizationId" = \(select current_user_organization_id\(\)\) \)/;

describe('ssbj_reports の RLS', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_reports enable row level security;');
  });

  it.each(['select', 'insert', 'update'])('%s は authenticated の自組織に限定される', command => {
    const policy = policyFor(command);
    expect(policy).toContain('on ssbj_reports');
    expect(policy).toContain('to authenticated');
    expect(policy).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it.each(['insert', 'update'])('%s の with check で年度の組織帰属を検証する', command => {
    const withCheck = policyFor(command).split('with check')[1] ?? '';
    expect(withCheck).toMatch(FISCAL_YEAR_CHECK);
  });

  it('delete のポリシーを持たない', () => {
    expect(policies.some(policy => /\bfor (delete|all)\b/.test(policy))).toBe(false);
  });
});

describe('ssbj_reports の GRANT', () => {
  const grantsToAuthenticated = grants.filter(
    grant => /\bon ssbj_reports\b/.test(grant) && /\bto authenticated\b/.test(grant),
  );

  it('authenticated に delete を付与しない', () => {
    expect(grantsToAuthenticated.some(grant => /\bdelete\b/.test(grant) || /\ball\b/.test(grant))).toBe(false);
  });

  it('update は基本情報の列だけ（組織・年度は作成後に変えられない）', () => {
    const updateGrant = grantsToAuthenticated.find(grant => grant.startsWith('grant update'));
    expect(updateGrant).toBeDefined();
    expect(updateGrant).not.toContain('"organizationId"');
    expect(updateGrant).not.toContain('"fiscalYearId"');
    expect(updateGrant).toContain('title');
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\bon ssbj_reports\b/.test(grant) && /\banon\b/.test(grant))).toBe(false);
  });
});

describe('ssbj_reports の外部キー', () => {
  it('年度の FK は連鎖削除しない（年度削除でレポートが消えない）', () => {
    const fiscalYearColumn = body.match(/"fiscalYearId" uuid not null references fiscal_years\(id\)[^,]*,/);
    expect(fiscalYearColumn).not.toBeNull();
    expect(fiscalYearColumn?.[0]).not.toContain('on delete cascade');
  });
});
