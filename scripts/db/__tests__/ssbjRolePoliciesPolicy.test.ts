// SSBJ のロールの適用（supabase/migrations/*_ssbj_role_policies.sql ほか）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 動作（ロールごとの拒否・見え方）はローカル DB で確かめ、ここでは取り違えると穴になる文面と、取り付け漏れを固定する。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const normalize = (sql: string): string =>
  sql.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
const files = readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
const all = files.map(file => normalize(readFileSync(path.join(migrationsDir, file), 'utf8'))).join(' ');
const migration = (suffix: string): string => {
  const name = files.find(file => file.endsWith(suffix));
  if (!name) throw new Error(`${suffix} のマイグレーションが見つかりません`);
  return normalize(readFileSync(path.join(migrationsDir, name), 'utf8'));
};
const policies = migration('_ssbj_role_policies.sql');
// ロールのポリシーのマイグレーションと、その後のマイグレーション（後から足した SSBJ のテーブルは、そこでポリシーを足す）。
const policiesFrom = files.slice(files.findIndex(file => file.endsWith('_ssbj_role_policies.sql')))
  .map(file => normalize(readFileSync(path.join(migrationsDir, file), 'utf8'))).join(' ');

const EDIT = '(select ssbj_current_user_can_edit())';
const VIEW = '(select ssbj_current_user_can_view_working())';

// 承認ロックのトリガー（reject_ssbj_change_when_approved）を付けたテーブル = SSBJ の作業中データのテーブル。
const workingTables = [...all.matchAll(
  /create trigger \w+ before insert or update or delete on (\w+) for each row execute function reject_ssbj_change_when_approved\(\)/g,
)].map(match => match[1]);

// そのテーブルに、利用者向けの（permissive の）ポリシーがある操作。
const permissiveCommands = (table: string, commands = ['select', 'insert', 'update', 'delete']): string[] =>
  commands.filter(command => new RegExp(`create policy "\\w+" on ${table} for ${command} to authenticated`).test(all));
const permissiveWrites = (table: string): string[] => permissiveCommands(table, ['insert', 'update', 'delete']);

// SSBJ のテーブル（どのマイグレーションで作ったものも）。
const ssbjTables = [...new Set(
  [...all.matchAll(/create table (?:if not exists )?(?:public\.)?(ssbj_\w+)/g)].map(match => match[1]),
)];

// ロールの RESTRICTIVE のポリシーを重ねないテーブルと、その理由。
const WITHOUT_ROLE_POLICIES: Record<string, string> = {
  ssbj_member_roles:
    'ロールの割り当てそのもの。書き込みは permissive のポリシーで管理者だけに限り、一覧は承認者の候補を出すため全員に見せる'
    + '（docs/authorization-matrix.md §2.4）',
};

describe('作業中データのテーブル（取り付け漏れの検出）', () => {
  it('作業中データのテーブルを見つけられる（承認ロックのトリガーから）', () => {
    expect(workingTables).toEqual(expect.arrayContaining([
      'ssbj_risks_opportunities', 'ssbj_report_time_horizons', 'ssbj_evidence', 'ssbj_ogt_adoptions',
      'ssbj_narratives', 'ssbj_judgements',
    ]));
  });

  it.each(workingTables)('%s: 閲覧者には見せない（RESTRICTIVE の select）', table => {
    expect(all).toContain(`on ${table} as restrictive for select to authenticated using (${VIEW});`);
  });

  it.each(workingTables)('%s: 利用者が書ける操作は、すべて入力担当か管理者に限る（RESTRICTIVE）', table => {
    const commands = permissiveWrites(table);
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const pattern = command === 'insert'
        ? `on ${table} as restrictive for insert to authenticated with check (${EDIT});`
        : command === 'update'
          ? `on ${table} as restrictive for update to authenticated using (${EDIT}) with check (${EDIT});`
          : `on ${table} as restrictive for delete to authenticated using (${EDIT});`;
      expect(all, `${table} の ${command}`).toContain(pattern);
    }
  });
});

describe('SSBJ のテーブル（ロールのポリシーの付け忘れの検出）', () => {
  it('マイグレーションの SSBJ のテーブルをすべて見つけられる', () => {
    expect(ssbjTables).toEqual(expect.arrayContaining([
      'ssbj_reports', 'ssbj_report_versions', 'ssbj_risks_opportunities', 'ssbj_report_time_horizons', 'ssbj_evidence',
      'ssbj_ogt_adoptions', 'ssbj_narratives', 'ssbj_judgements', 'ssbj_audit_logs', 'ssbj_member_roles',
    ]));
  });

  it('ポリシーを重ねないテーブルは実在し、理由を書いている', () => {
    for (const [table, reason] of Object.entries(WITHOUT_ROLE_POLICIES)) {
      expect(ssbjTables).toContain(table);
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it.each(ssbjTables.filter(table => !(table in WITHOUT_ROLE_POLICIES)))(
    '%s: 利用者に許した操作ごとに、ロールの RESTRICTIVE のポリシーを重ねている（ロールのポリシーのマイグレーションか、その後）',
    table => {
      const commands = permissiveCommands(table);
      expect(commands.length, `${table} に利用者向けのポリシーが見つかりません`).toBeGreaterThan(0);
      for (const command of commands) {
        expect(policiesFrom, `${table} の ${command}`).toMatch(
          new RegExp(`create policy "\\w+" on ${table} as restrictive for ${command} to authenticated`),
        );
      }
    },
  );
});

describe('レポート・保存版・操作履歴', () => {
  it('レポートの作成・基本情報の更新は入力担当か管理者だけ', () => {
    expect(policies).toContain(`on ssbj_reports as restrictive for insert to authenticated with check (${EDIT});`);
    expect(policies).toContain(`on ssbj_reports as restrictive for update to authenticated using (${EDIT}) with check (${EDIT});`);
  });

  it('閲覧者は承認済みのレポートだけを見る', () => {
    expect(policies).toContain(`on ssbj_reports as restrictive for select to authenticated using (${VIEW} or status = 'approved');`);
  });

  it('保存版（内部メモ・内部記録を含む）は、承認した版も含めて閲覧者に見せない', () => {
    expect(policies).toContain(`on ssbj_report_versions as restrictive for select to authenticated using (${VIEW});`);
    expect(policies).not.toMatch(/on ssbj_report_versions as restrictive for select to authenticated using \([^;]* or /);
  });

  it('操作履歴は閲覧者に見せない', () => {
    expect(policies).toContain(`on ssbj_audit_logs as restrictive for select to authenticated using (${VIEW});`);
  });

  it('閲覧者が記録できる出力は、承認した保存版の CSV / Excel だけ', () => {
    expect(policies).toContain("if not public.ssbj_current_user_can_view_working() and ( p_format not in ('csv', 'xlsx') or p_version_id is null or not exists ( select 1 from public.ssbj_reports r where r.id = p_report_id and r.status = 'approved' and r.\"approvedVersionId\" = p_version_id ) ) then");
    expect(policies).toContain('grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;');
  });
});

describe('状態の変更', () => {
  it('権限は SSBJ のロールで判定する（profiles.role を直接読まない）', () => {
    expect(policies).toContain('v_actor_role := ssbj_user_role(p_actor_user_id, p_organization_id);');
    expect(policies).not.toContain('select role into v_actor_role from profiles');
  });

  it('承認・差戻しは、管理者か、指定された承認者でロールが承認担当の人', () => {
    expect(policies).toContain("v_is_privileged := v_actor_role = 'admin' or (v_actor_role = 'approver' and p_actor_user_id = v_report.\"approverUserId\");");
  });

  it('レビュー依頼・取り下げは入力担当か管理者。承認者には承認担当か管理者だけを指定できる', () => {
    expect(policies).toContain("if p_action in ('submit', 'withdraw') and v_actor_role not in ('admin', 'editor') then");
    expect(policies).toContain('if p_approver_user_id is null or not ssbj_user_can_approve(p_approver_user_id, p_organization_id) then');
  });

  it('自己承認の禁止と差戻しの理由の必須は残す', () => {
    expect(policies).toContain('v_blocker := ssbj_approval_blocker(p_report_id, p_actor_user_id);');
    expect(policies).toContain("if v_comment is null then raise exception '差戻しの理由を入力してください' using errcode = 'P2057';");
  });

  it('引き続き service_role 限定', () => {
    expect(policies).toContain('revoke execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;');
    expect(policies).toContain('grant execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) to service_role;');
  });
});

describe('OGT 本体の権限の仕組みは変えない', () => {
  it('本体のテーブル・関数にポリシーや変更を足さない', () => {
    expect(policies).not.toMatch(/on (public\.)?(profiles|invites|organizations|locations|activity_records|emission_factors) /);
    expect(policies).not.toMatch(/function (public\.)?current_user_(can_edit|is_admin|role)\(\)/);
  });
});
