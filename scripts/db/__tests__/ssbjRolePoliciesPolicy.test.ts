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

const EDIT = '(select ssbj_current_user_can_edit())';
const VIEW = '(select ssbj_current_user_can_view_working())';

// 承認ロックのトリガー（reject_ssbj_change_when_approved）を付けたテーブル = SSBJ の作業中データのテーブル。
const workingTables = [...all.matchAll(
  /create trigger \w+ before insert or update or delete on (\w+) for each row execute function reject_ssbj_change_when_approved\(\)/g,
)].map(match => match[1]);

// そのテーブルに、利用者向けの（permissive の）書き込みのポリシーがある操作。
const permissiveWrites = (table: string): string[] =>
  ['insert', 'update', 'delete'].filter(command =>
    new RegExp(`create policy "\\w+" on ${table} for ${command} to authenticated`).test(all));

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

describe('レポート・保存版・操作履歴', () => {
  it('レポートの作成・基本情報の更新は入力担当か管理者だけ', () => {
    expect(policies).toContain(`on ssbj_reports as restrictive for insert to authenticated with check (${EDIT});`);
    expect(policies).toContain(`on ssbj_reports as restrictive for update to authenticated using (${EDIT}) with check (${EDIT});`);
  });

  it('閲覧者は承認済みのレポートと、その承認した保存版だけを見る', () => {
    expect(policies).toContain(`on ssbj_reports as restrictive for select to authenticated using (${VIEW} or status = 'approved');`);
    const versions = policies.slice(policies.indexOf('create policy "ssbj_report_versions_select_viewer_approved_only"'));
    expect(versions.slice(0, versions.indexOf(';'))).toContain(
      `${VIEW} or exists ( select 1 from ssbj_reports r where r.id = ssbj_report_versions."reportId" and r.status = 'approved' and r."approvedVersionId" = ssbj_report_versions.id )`,
    );
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
