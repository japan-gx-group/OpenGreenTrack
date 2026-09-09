// 算定結果テーブルの権限に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 検証対象: 20260831000001_rls.sql の emission_results / calculation_batches / dashboard_aggregates。
//   この 3 本に authenticated の書き込み（ポリシーまたは GRANT）が戻ると、PostgREST 直叩きで
//   算定エンジン・レート制限・system_audit_logs を通さない報告値の書き換えが再び通る。
//   書き込み RPC の EXECUTE を service_role 限定にしている前提（20260831000002_rpc.sql）が
//   テーブル権限側から崩れていないことを固定する。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** 書き込みを service_role 経由に限定するテーブル */
const READ_ONLY_TABLES = ['emission_results', 'calculation_batches', 'dashboard_aggregates'];

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

/** `create policy …;` を 1 文ずつ取り出す */
const policies = body.match(/create policy[^;]*;/g) ?? [];

/** `grant …;` を 1 文ずつ取り出す */
const grants = body.match(/grant [^;]*;/g) ?? [];

describe.each(READ_ONLY_TABLES)('%s は authenticated には読み取り専用', table => {
  const policiesOnTable = policies.filter(policy =>
    new RegExp(`\\bon ${table}\\b`).test(policy),
  );
  const grantsToAuthenticated = grants.filter(
    grant => new RegExp(`\\b${table}\\b`).test(grant) && /to authenticated;$/.test(grant),
  );

  it('ポリシーは select だけ', () => {
    expect(policiesOnTable).not.toHaveLength(0);
    for (const policy of policiesOnTable) {
      expect(policy).toMatch(/for select/);
    }
  });

  it('authenticated への GRANT に insert / update / delete が含まれない', () => {
    expect(grantsToAuthenticated).not.toHaveLength(0);
    for (const grant of grantsToAuthenticated) {
      // grant の対象列・テーブル名ではなく操作の並びだけを見る（列指定 GRANT を書いた場合も同じ判定になる）。
      const operations = grant.slice('grant '.length, grant.indexOf(' on '));
      expect(operations).toBe('select');
    }
  });
});

describe('service_role の書き込み経路', () => {
  it('全テーブルへの GRANT が残っている', () => {
    // 算定コミット・集計再計算の RPC はこの GRANT で書く。剥がすと算定そのものが止まる。
    expect(body).toContain(
      'grant select, insert, update, delete on all tables in schema public to service_role;',
    );
  });
});
