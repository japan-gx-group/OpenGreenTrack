// public スキーマの default privileges に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 検証対象: 20260831000001_rls.sql §4.1 の `alter default privileges … revoke`。
//   Supabase は postgres ロールに default privileges を設定していて、public に作られる
//   テーブル・シーケンス・関数へ anon / authenticated / service_role の ALL が自動で付く。
//   §4.1 の個別 revoke は「今あるテーブル」しか剥がせないため、これを消しておかないと
//   テーブルを追加したときに §4.1 への追記漏れがそのまま anon への全権限付与になり、
//   RLS と GRANT の二重の防御のうち GRANT 側が外れる。
//   あわせて §4.4 の service_role への自動付与が残っていることも確認する
//   （Route Handler が使うサーバ専用ロールで、ここまで剥がすと新テーブルが service_role から触れなくなる）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rlsSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260831000001_rls.sql'),
  'utf8',
);

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = rlsSql
  .split('\n')
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

/** `alter default privileges …;` を 1 文ずつ取り出す */
const alterDefaultPrivileges = body.match(/alter default privileges[^;]*;/g) ?? [];

describe('§4.1 default privileges の既定拒否', () => {
  it.each(['tables', 'sequences', 'functions'])(
    'public の新規 %s を anon / authenticated から剥奪する',
    objectType => {
      expect(body).toContain(
        `alter default privileges for role postgres in schema public revoke all on ${objectType} from anon, authenticated;`,
      );
    },
  );

  it('剥奪はロールとスキーマを明示する', () => {
    // ロールを省略すると適用者、スキーマを省略すると全スキーマに依存して結果が変わる。
    // マイグレーションを流すのは postgres で、アプリのオブジェクトは public にしかない。
    const revokes = alterDefaultPrivileges.filter(statement => statement.includes('revoke'));
    expect(revokes).toHaveLength(3);
    for (const statement of revokes) {
      expect(statement).toContain('for role postgres in schema public');
    }
  });

  it('service_role からは剥奪しない', () => {
    for (const statement of alterDefaultPrivileges.filter(s => s.includes('revoke'))) {
      expect(statement).not.toContain('service_role');
    }
  });
});

describe('§4.4 service_role への自動付与', () => {
  it.each([
    'grant select, insert, update, delete on tables to service_role;',
    'grant usage, select on sequences to service_role;',
  ])('%s が残っている', grantStatement => {
    expect(body).toContain(`alter default privileges in schema public ${grantStatement}`);
  });
});
