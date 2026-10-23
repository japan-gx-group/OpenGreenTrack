// 組織の設定を管理者だけにする（20261024120000_admin_only_settings.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// - current_user_is_admin() は「ログイン中の利用者の role が admin か」を返す（organizations の更新・invites のポリシーが参照）
// - search_path を空にした security definer のまま（RLS の中から profiles を読むため）
// - current_user_can_edit() は差し替えない（データの編集はロールにかかわらず全員が行う）
// - 権限（GRANT）・ポリシーには触れない（ポリシーは関数の差し替えだけで管理者に絞られる）

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261024120000_admin_only_settings.sql'),
  'utf8',
);

const rlsSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260831000001_rls.sql'),
  'utf8',
);

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const collapse = (sql: string) =>
  sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');

const body = collapse(migrationSql);

describe('current_user_is_admin()', () => {
  it('ログイン中の利用者の role が admin かを返す', () => {
    expect(body).toMatch(
      /create or replace function current_user_is_admin\(\) returns boolean language sql stable security definer set search_path = '' as \$\$ select exists \( select 1 from public\.profiles p where p\.id = auth\.uid\(\) and p\.role = 'admin' \) \$\$;/,
    );
  });

  it('企業情報の更新と招待のポリシーが、この関数を参照している（差し替えるだけで管理者に絞られる）', () => {
    const rls = collapse(rlsSql);
    for (const policy of [
      'organizations_update_own',
      'invites_select_own_organization_admin',
      'invites_insert_own_organization_admin',
      'invites_delete_own_organization_admin',
    ]) {
      const match = rls.match(new RegExp(`create policy "${policy}".*?;`));
      expect(match?.[0]).toContain('current_user_is_admin()');
    }
  });
});

describe('このマイグレーションで変えないもの', () => {
  it('current_user_can_edit() は定義し直さない（説明だけを改める）', () => {
    expect(body).not.toMatch(/function current_user_can_edit\(\) returns/);
    expect(body).toMatch(/comment on function current_user_can_edit\(\) is/);
  });

  it('権限とポリシーには触れない', () => {
    expect(body).not.toMatch(/\b(grant|revoke)\b/);
    expect(body).not.toMatch(/create policy|drop policy|alter policy/);
  });
});
