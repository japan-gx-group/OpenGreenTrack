// SSBJ レポートの基本情報の追加列（親会社との関係・持分比率・測定アプローチ・業種）に対する回帰テスト
// （実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - 追加列は任意（NULL 可）で、既存行を書き換えない（R12）
//   - 値は制約で選択肢・範囲に限定する（測定アプローチは気候関連開示基準 第60項の 3 つ）
//   - 追加列の変更でも draftRevision を進める（保存版の競合検知が効く）
//   - 保存版の report に追加列を含め、持分比率は十進表記の文字列にする（docs/ssbj-spec.md §6）
//   - 版生成 RPC は service_role 限定のまま、組織・年度は作成後に付け替えられないまま

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_report_parent_and_industry.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_report_parent_and_industry のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const ADDED_COLUMNS = [
  '"parentCompanyName"',
  '"parentRelationship"',
  '"ownershipPercentage"',
  '"measurementApproach"',
  '"industryCode"',
];

describe('追加列', () => {
  it.each(ADDED_COLUMNS)('%s は NULL 可で追加する（not null・default を付けない）', column => {
    const definition = body.match(new RegExp(`add column ${column} [^,;]+`))?.[0] ?? '';
    expect(definition).not.toBe('');
    expect(definition).not.toContain('not null');
    expect(definition).not.toContain('default');
  });

  it('値を制約で限定する', () => {
    expect(body).toContain(
      `check ( "parentRelationship" in ( 'consolidated_subsidiary', 'non_consolidated_subsidiary', 'equity_method_affiliate', 'other' ) )`,
    );
    expect(body).toContain(`check ( "ownershipPercentage" > 0 and "ownershipPercentage" <= 100 )`);
    expect(body).toContain(
      `check ( "measurementApproach" in ('equity_share', 'operational_control', 'financial_control') )`,
    );
    expect(body).toContain('ssbj_reports_industry_code_check');
  });
});

describe('権限', () => {
  const grant = body.match(/grant insert \([^)]*\), update \([^)]*\) on ssbj_reports to authenticated;/)?.[0] ?? '';

  it('追加列だけを insert / update に付与し、組織・年度は含めない', () => {
    expect(grant).not.toBe('');
    for (const column of ADDED_COLUMNS) {
      expect(grant).toContain(column);
    }
    expect(grant).not.toContain('"organizationId"');
    expect(grant).not.toContain('"fiscalYearId"');
    expect(grant).not.toContain('"draftRevision"');
  });

  it('版生成 RPC は service_role 限定のまま', () => {
    expect(body).toMatch(
      /revoke execute on function create_ssbj_report_version\([^)]*\) from public, anon, authenticated;/,
    );
    expect(body).toMatch(/grant execute on function create_ssbj_report_version\([^)]*\) to service_role;/);
  });
});

describe('draftRevision と保存版', () => {
  it('追加列の変更でも draftRevision を進める', () => {
    const trigger = body.match(/create or replace function bump_ssbj_reports_own_draft_revision\(\)[\s\S]*?\$\$;/)?.[0];
    expect(trigger).toBeDefined();
    for (const column of ADDED_COLUMNS) {
      expect(trigger).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it('保存版の report に追加列を含め、持分比率は文字列にする', () => {
    const rpc = body.match(/create or replace function create_ssbj_report_version\([\s\S]*?\$\$;/)?.[0] ?? '';
    expect(rpc).toContain(`'parentCompanyName', v_report."parentCompanyName"`);
    expect(rpc).toContain(`'parentRelationship', v_report."parentRelationship"`);
    expect(rpc).toContain(`'ownershipPercentage', v_report."ownershipPercentage"::text`);
    expect(rpc).toContain(`'measurementApproach', v_report."measurementApproach"`);
    expect(rpc).toContain(`'industryCode', v_report."industryCode"`);
  });

  it('版生成 RPC の競合検知・組織帰属の確認は残っている', () => {
    const rpc = body.match(/create or replace function create_ssbj_report_version\([\s\S]*?\$\$;/)?.[0] ?? '';
    expect(rpc).toMatch(/from ssbj_reports where id = p_report_id for update;/);
    expect(rpc).toContain('v_report."organizationId" <> p_organization_id');
    expect(rpc).toContain('v_report."draftRevision" <> p_expected_draft_revision');
    expect(rpc).toContain("errcode = 'P2033'");
  });
});
