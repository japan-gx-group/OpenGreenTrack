// SSBJ のロール（supabase/migrations/*_ssbj_member_roles.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 動作（割り当て・変更・拒否・組織分離・操作履歴）はローカル DB で確かめ、ここでは取り違えると穴になる文面を固定する。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_MEMBER_ROLES } from '@/features/ssbj/types';
import { isAdmin } from '@/types/role';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const migration = (suffix: string): string => {
  const name = readdirSync(migrationsDir).find(file => file.endsWith(suffix));
  if (!name) throw new Error(`${suffix} のマイグレーションが見つかりません`);
  return readFileSync(path.join(migrationsDir, name), 'utf8')
    .split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
};
const roles = migration('_ssbj_member_roles.sql');
const surrogateKey = migration('_ssbj_member_roles_surrogate_key.sql');

describe('SSBJ のロールのテーブル', () => {
  it('ロールの値は types.ts と同じ', () => {
    const values = roles.match(/check \(role in \(([^)]*)\)\)/)?.[1].split(',').map(value => value.trim().replace(/'/g, ''));
    expect(values).toEqual([...SSBJ_MEMBER_ROLES]);
  });

  it('組織×利用者で 1 行。組織・利用者の削除で消える', () => {
    expect(roles).toContain('"organizationId" uuid not null references organizations(id) on delete cascade');
    expect(roles).toContain('"userId" uuid not null references profiles(id) on delete cascade');
    expect(surrogateKey).toContain('add constraint ssbj_member_roles_organization_user_key unique ("organizationId", "userId")');
  });

  it('主キーは id で、組織・利用者の列を主キーにしない（PostgREST が profiles ↔ organizations の中間テーブルとみなし、本体の埋め込みが壊れるため）', () => {
    expect(surrogateKey).toContain('alter table ssbj_member_roles drop constraint ssbj_member_roles_pkey;');
    expect(surrogateKey).toContain('alter table ssbj_member_roles add column id uuid not null default gen_random_uuid();');
    expect(surrogateKey).toContain('alter table ssbj_member_roles add constraint ssbj_member_roles_pkey primary key (id);');
  });
});

describe('ロールの判定', () => {
  it('OGT の管理者は管理者、割り当てが無ければ入力担当、組織の利用者でなければ null', () => {
    expect(roles).toContain("select case when p.role = 'admin' then 'admin' else coalesce(m.role, 'editor') end");
    expect(roles).toContain('where p.id = p_user_id and p."organizationId" = p_organization_id;');
  });

  it('利用者を指定する関数は service_role 限定。ログイン中の利用者の関数は authenticated', () => {
    for (const fn of ['ssbj_user_role(uuid, uuid)', 'ssbj_user_can_approve(uuid, uuid)']) {
      expect(roles).toContain(`revoke execute on function ${fn} from public, anon, authenticated;`);
      expect(roles).toContain(`grant execute on function ${fn} to service_role;`);
    }
    for (const fn of ['ssbj_current_user_role()', 'ssbj_current_user_can_edit()', 'ssbj_current_user_can_view_working()', 'ssbj_current_user_is_admin()']) {
      expect(roles).toContain(`revoke execute on function ${fn} from public, anon;`);
      expect(roles).toContain(`grant execute on function ${fn} to authenticated;`);
    }
  });

  it('できることの判定（編集は入力担当か管理者、閲覧は閲覧者以外、承認は承認担当か管理者）', () => {
    expect(roles).toContain("public.ssbj_current_user_role() in ('admin', 'editor')");
    expect(roles).toContain("public.ssbj_current_user_role() in ('admin', 'editor', 'approver')");
    expect(roles).toContain("public.ssbj_user_role(p_user_id, p_organization_id) in ('admin', 'approver')");
  });
});

describe('RLS と権限', () => {
  it('見るのは自組織の全員。割り当て・変更・解除は管理者だけ', () => {
    expect(roles).toContain('create policy "ssbj_member_roles_select_own_organization" on ssbj_member_roles for select to authenticated using ("organizationId" = (select current_user_organization_id()));');
    for (const policy of ['insert_admin', 'update_admin', 'delete_admin']) {
      const start = roles.indexOf(`create policy "ssbj_member_roles_${policy}"`);
      expect(start).toBeGreaterThan(0);
      expect(roles.slice(start, roles.indexOf(';', start))).toContain('(select ssbj_current_user_is_admin())');
    }
  });

  it('割り当てられるのは同じ組織の利用者だけ', () => {
    const insert = roles.slice(roles.indexOf('create policy "ssbj_member_roles_insert_admin"'));
    expect(insert.slice(0, insert.indexOf(';'))).toContain('p.id = "userId" and p."organizationId" = (select current_user_organization_id())');
  });

  it('利用者が書ける列は割り当てに必要な列だけ', () => {
    expect(roles).toContain('grant insert ("organizationId", "userId", role) on ssbj_member_roles to authenticated;');
    expect(roles).toContain('grant update (role) on ssbj_member_roles to authenticated;');
  });
});

describe('操作履歴', () => {
  it('割り当て・変更・解除をレポートに属さない記録として残す（reportId を空にできるのはロールの記録だけ）', () => {
    expect(roles).toContain('alter column "reportId" drop not null');
    expect(roles).toContain('add constraint ssbj_audit_logs_report_required check ("reportId" is not null or "targetType" = \'member_role\')');
    expect(roles).toContain('create trigger audit_ssbj_member_roles after insert or update or delete on ssbj_member_roles');
  });

  it('組織の削除に伴う連鎖削除では記録しない（デモデータの入れ直しを止めない）', () => {
    expect(roles).toContain('if not exists (select 1 from public.organizations o where o.id = v_row."organizationId") then return null;');
  });

  it('解除の操作者に、行に残っている以前の更新者を使わない（利用者の削除に伴う解除は操作者を空にし、member_deleted を残す）', () => {
    // 記録するトリガー関数の最後の定義を調べる（あとから定義し直したときにも、この規則を外さないため）。
    const definitions = readdirSync(migrationsDir).sort()
      .filter(file => readFileSync(path.join(migrationsDir, file), 'utf8').includes('function ssbj_audit_member_role_change()'));
    const latest = migration(definitions[definitions.length - 1]);
    const deleteBranch = latest.slice(latest.indexOf("if tg_op = 'DELETE' then"), latest.indexOf("elsif tg_op = 'INSERT' then"));

    expect(latest).toContain("v_actor uuid := coalesce(auth.uid(), nullif(current_setting('ssbj.actor_user_id', true), '')::uuid);");
    expect(deleteBranch).not.toContain('updatedByUserId');
    expect(deleteBranch).toContain('if not exists (select 1 from public.profiles p where p.id = old."userId") then');
    expect(deleteBranch).toContain("jsonb_build_object('reason', 'member_deleted')");
    expect(latest).toContain('values (v_row."organizationId", null, v_actor, v_action, \'member_role\'');
    expect(latest).toContain('if not exists (select 1 from public.organizations o where o.id = v_row."organizationId") then return null;');
  });
});

describe('SSBJ の管理者は、OGT 本体の管理者と同じ条件で決める', () => {
  // 本体の管理者の判定（DB の current_user_is_admin()・画面とサーバの isAdmin()）が「role が admin か」から変わったら、
  // SSBJ の ssbj_user_role（と utils/memberRole.ts の effectiveSsbjRole）も同じ条件に直す。このテストはその合図にする。
  const allMigrations = readdirSync(migrationsDir).sort()
    .map(name => readFileSync(path.join(migrationsDir, name), 'utf8'))
    .join('\n').split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
  const latestBody = (fn: string): string => {
    const definitions = [...allMigrations.matchAll(new RegExp(`create (?:or replace )?function (?:public\\.)?${fn}\\(\\)[^$]*\\$\\$(.*?)\\$\\$`, 'g'))];
    if (definitions.length === 0) throw new Error(`${fn} の定義が見つかりません`);
    return definitions[definitions.length - 1][1];
  };

  it('本体の current_user_is_admin() は「role が admin か」で判定している（SSBJ の ssbj_user_role と同じ条件）', () => {
    expect(latestBody('current_user_is_admin')).toContain("p.role = 'admin'");
    expect(roles).toContain("case when p.role = 'admin' then 'admin'");
  });

  it('本体の isAdmin() も「role が admin か」だけで判定している（logger・viewer はメンバー）', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('logger')).toBe(false);
    expect(isAdmin('viewer')).toBe(false);
  });
});

describe('OGT 本体の権限の仕組みは変えない', () => {
  it('本体の関数・profiles・invites を書き換えない', () => {
    expect(roles).not.toMatch(/function (public\.)?current_user_(can_edit|is_admin|role)\(\)/);
    expect(roles).not.toMatch(/alter table (public\.)?(profiles|invites)/);
  });
});
