// メンバーのロール（20261024090000_member_roles.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// - 最後の管理者を守るトリガーは、profiles の role・organizationId の更新と削除の両方に付く
//   （退会は auth.users の削除から連鎖する削除なので、削除にも付いていないと止められない）
// - トリガーは組織ごとのロックを取ってから数える（同時の降格で 0 人にならないように）
// - 組織ごとの削除（organizations からの連鎖）は止めない（デモの seed が組織ごと入れ直す）
// - ロールを変える RPC は service_role 限定で、ロックを取ったあとに操作する人が管理者かを読み直す
// - RPC が書ける値は admin / logger だけで、監査ログを同じトランザクションで残す
// - 組織の設定の権限（current_user_is_admin）はこのマイグレーションでは変えない

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261024090000_member_roles.sql'),
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

const lockStatement = `perform pg_advisory_xact_lock(hashtext('organization_admins:' ||`;

describe('最後の管理者を守るトリガー', () => {
  it('profiles の role・organizationId の更新と削除の両方の前に付く', () => {
    expect(body).toContain(
      'create trigger ensure_organization_keeps_admin before update of role, "organizationId" or delete on profiles for each row execute function ensure_organization_keeps_admin();',
    );
  });

  it('組織ごとのロックを取ってから、ほかの管理者がいるかを数え、いなければ P2081 で拒否する', () => {
    const fn = functionBody('ensure_organization_keeps_admin');
    const lockAt = fn.indexOf(lockStatement);
    const countAt = fn.indexOf(`p.role = 'admin' and p.id <> old.id`);
    expect(lockAt).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(lockAt);
    expect(fn).toMatch(/using errcode = 'P2081'/);
  });

  it('組織そのものが無くなっている（組織ごとの削除）ときは止めない', () => {
    const fn = functionBody('ensure_organization_keeps_admin');
    expect(fn).toMatch(/exists \( select 1 from public\.organizations o where o\.id = old\."organizationId" \) and not exists/);
  });

  it('search_path を空にした security definer（RLS に左右されずに数える）', () => {
    const fn = functionBody('ensure_organization_keeps_admin');
    expect(fn).toMatch(/security definer set search_path = ''/);
  });
});

describe('ロールを変える RPC（change_member_role）', () => {
  it('EXECUTE は service_role だけ', () => {
    expect(body).toContain(
      'revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;',
    );
    expect(body).toContain('grant execute on function change_member_role(uuid, uuid, text) to service_role;');
  });

  it('書ける値は admin と logger だけ（それ以外は P2084）', () => {
    const fn = functionBody('change_member_role');
    expect(fn).toMatch(/p_role not in \('admin', 'logger'\)/);
    expect(fn).toMatch(/using errcode = 'P2084'/);
  });

  it('ロックを取ったあとに、操作する人が同じ組織の管理者かを読み直す（P2082）', () => {
    const fn = functionBody('change_member_role');
    const lockAt = fn.indexOf(lockStatement);
    const actorCheckAt = fn.indexOf(`v_actor_role <> 'admin'`);
    expect(lockAt).toBeGreaterThan(-1);
    expect(actorCheckAt).toBeGreaterThan(lockAt);
    expect(fn).toMatch(/using errcode = 'P2082'/);
  });

  it('対象は操作する人と同じ組織のメンバーに限る（P2083）', () => {
    const fn = functionBody('change_member_role');
    expect(fn).toMatch(/where id = p_target_user_id and "organizationId" = v_organization_id for update/);
    expect(fn).toMatch(/using errcode = 'P2083'/);
  });

  it('変更を system_audit_logs に member.role.update として残す', () => {
    const fn = functionBody('change_member_role');
    expect(fn).toMatch(/insert into system_audit_logs .*'member\.role\.update'/);
  });
});

describe('このマイグレーションで変えないもの', () => {
  it('組織の設定の権限（current_user_is_admin・current_user_can_edit）には触れない', () => {
    expect(body).not.toMatch(/function current_user_is_admin/);
    expect(body).not.toMatch(/function current_user_can_edit/);
  });

  it('profiles.role の列 GRANT は広げない（本人はロールを変えられないまま）', () => {
    expect(body).not.toMatch(/grant update[^;]*role[^;]* on profiles/);
  });
});
