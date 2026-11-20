// 閲覧者を読み取り専用にする（20261120010605_viewer_role_policies.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// SQL の文面だけを見るため、ポリシーが実際の PostgreSQL でどう効くかはここでは確かめない。
//
// - current_user_can_edit() は「profiles 行があり、role が viewer でないか」を返す
// - 9 テーブルの insert / update / delete、証憑の insert / delete、import-files の削除に restrictive ポリシーを重ねる
// - 閲覧・自分のプロフィールの更新・出力の記録・管理者向けの設定には触れない
// - change_member_role は値の検証と no-op の判定だけを変え、最後の管理者の保護はそのまま
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const normalize = (sql: string): string => sql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');
const readMigration = (name: string): string => normalize(readFileSync(
  path.join(process.cwd(), 'supabase/migrations', name), 'utf8',
));
const body = readMigration('20261120010605_viewer_role_policies.sql');
const originalRoles = readMigration('20261024090000_member_roles.sql');
const originalRls = readMigration('20260831000001_rls.sql');
const evidence = readMigration('20261026120000_activity_evidence.sql');
const fn = (sql: string, name: string): string => {
  const match = sql.match(new RegExp(`create (?:or replace )?function (?:public\\.)?${name}\\(.*?\\$\\$;`));
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
};
const tables = [
  'suppliers', 'locations', 'emission_factors', 'activity_records',
  'scope3_category_emissions', 'supplier_emissions', 'scope3_category_methods',
  'reduction_targets', 'reduction_target_years',
];
const expectedPolicies = [
  ...tables.flatMap(table => ['insert', 'update', 'delete'].map(operation => ({
    table: `public.${table}`, operation, name: `${table}_${operation}_requires_editor`,
  }))),
  ...['insert', 'delete'].map(operation => ({
    table: 'public.activity_record_evidence', operation,
    name: `activity_record_evidence_${operation}_requires_editor`,
  })),
  { table: 'storage.objects', operation: 'delete', name: 'import_files_delete_requires_editor' },
];
const policies = body.match(/create policy .*?;/g) ?? [];

describe('閲覧者の書き込みの制限', () => {
  it('profiles 行があり、role が viewer でない利用者だけを書ける者とする', () => {
    expect(fn(body, 'current_user_can_edit')).toContain(
      "returns boolean language sql stable security definer set search_path = '' as $$ select exists ( select 1 from public.profiles p where p.id = auth.uid() and p.role <> 'viewer' ) $$;",
    );
    expect(originalRls).toContain('grant execute on function current_user_can_edit() to authenticated;');
  });

  it('想定どおりの 30 本のポリシーを過不足なく足す', () => {
    expect(policies).toHaveLength(30);
    expect(policies.map(policy => policy.match(/create policy "([^"]+)"/)?.[1]).sort())
      .toEqual(expectedPolicies.map(policy => policy.name).sort());
  });

  it.each(expectedPolicies)('$name は正しいコマンドとロールに絞る', ({ table, operation, name }) => {
    const policy = policies.find(statement => statement.startsWith(`create policy "${name}" `));
    expect(policy).toBeDefined();
    expect(policy).toContain(`on ${table} as restrictive for ${operation} to authenticated`);
    expect(policy).toContain('(select public.current_user_can_edit())');
    if (operation === 'insert') {
      expect(policy).toContain('with check ((select public.current_user_can_edit()))');
      expect(policy).not.toContain('using');
    } else {
      expect(policy).toContain('using (');
      if (operation === 'update') {
        expect(policy).toContain('using ((select public.current_user_can_edit()))');
        expect(policy).toContain('with check ((select public.current_user_can_edit()))');
      } else {
        expect(policy).not.toContain('with check');
      }
    }
  });

  it('Storage は import-files の削除だけを絞り、証憑フォルダの除外を残す', () => {
    const storage = policies.find(policy => policy.includes('on storage.objects'));
    expect(storage).toContain("using ( bucket_id <> 'import-files' or (select public.current_user_can_edit()) )");
    expect(evidence).toContain("and (storage.foldername(name))[2] is distinct from 'activity-evidence'");
    expect(body).not.toMatch(/\b(?:alter|drop) policy\b/);
  });

  it('閲覧・プロフィールの更新・出力の記録・管理者向けの設定には触れない', () => {
    expect(policies.join(' ')).not.toMatch(/for (?:select|all)\b|on (?:public\.)?(?:profiles|system_audit_logs|organizations|invites)\b/);
    expect(body).not.toMatch(/grant (?:update|insert|select|delete)\b|function (?:public\.)?current_user_is_admin\(/);
    expect(originalRls).toContain('grant update ("fullName", phone) on profiles to authenticated;');
    expect(originalRls).toContain('grant select, insert on system_audit_logs to authenticated;');
  });
});

describe('3 ロールのロール変更', () => {
  it('値の検証と no-op の判定以外は RPC の実装を変えない', () => {
    const expected = fn(originalRoles, 'change_member_role')
      .replace('create function ', 'create or replace function ')
      .replace("p_role not in ('admin', 'logger')", "p_role not in ('admin', 'logger', 'viewer')")
      .replace("(v_previous_role = 'admin') = (p_role = 'admin')", 'v_previous_role = p_role');
    expect(fn(body, 'change_member_role')).toBe(expected);
  });

  it('実行は service_role 限定のまま', () => {
    expect(body).toContain('revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;');
    expect(body).toContain('grant execute on function change_member_role(uuid, uuid, text) to service_role;');
  });

  it('最後の管理者の保護（トリガー）を変えない', () => {
    const guard = fn(originalRoles, 'ensure_organization_keeps_admin');
    expect(guard).toContain("v_checks_admins := old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin' or new.\"organizationId\" <> old.\"organizationId\");");
    expect(guard).toContain("p.role = 'admin' and p.id <> old.id");
    expect(guard).toContain("using errcode = 'P2081'");
    expect(body).not.toMatch(/function (?:public\.)?ensure_organization_keeps_admin\(|\b(?:create|drop|alter) trigger\b/);
  });
});
