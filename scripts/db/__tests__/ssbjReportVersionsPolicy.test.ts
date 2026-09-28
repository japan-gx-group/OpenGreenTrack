// SSBJ レポートの保存版（ssbj_report_versions）と版生成 RPC の RLS・権限・不変性に対する回帰テスト
// （実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること（docs/ssbj-spec.md §8）:
//   - 組織分離: 保存版の select は自組織に限定され、authenticated には select 以外を許可しない
//   - 不変性: UPDATE はトリガーで全ロール（service_role を含む）拒否する
//   - 書き込み経路: 版生成 RPC は service_role 限定（authenticated が任意の中身で版を作れない）
//   - 競合防止: RPC はレポート行をロックし、組織帰属と draftRevision の一致を確かめる
//   - 版番号はレポート内で一意

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { SSBJ_VERSION_SQLSTATE } from '@/features/ssbj/services/versionServer';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_report_versions.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_report_versions のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy =>
  /\bon ssbj_report_versions\b/.test(policy),
);
const grants = body.match(/grant [^;]*;/g) ?? [];

/** 関数定義（create function <name>( … $$ … $$;）の全文 */
const functionBody = (name: string): string => {
  const match = body.match(new RegExp(`create function ${name}\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$;`));
  if (!match) throw new Error(`関数 ${name} がありません`);
  return match[0];
};

describe('ssbj_report_versions の RLS', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_report_versions enable row level security;');
  });

  it('select は authenticated の自組織に限定される', () => {
    const select = policies.find(policy => /\bfor select\b/.test(policy));
    expect(select).toBeDefined();
    expect(select).toContain('to authenticated');
    expect(select).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it('select 以外のポリシーを持たない（書き込みは RPC 経由のみ）', () => {
    expect(policies.some(policy => /\bfor (insert|update|delete|all)\b/.test(policy))).toBe(false);
  });
});

describe('ssbj_report_versions の GRANT', () => {
  const grantsOnTable = grants.filter(grant => /\bon ssbj_report_versions\b/.test(grant));

  it('authenticated には select だけを付与する', () => {
    const toAuthenticated = grantsOnTable.filter(grant => /\bto authenticated\b/.test(grant));
    expect(toAuthenticated).toEqual(['grant select on ssbj_report_versions to authenticated;']);
  });

  it('anon には何も付与しない', () => {
    expect(grantsOnTable.some(grant => /\banon\b/.test(grant))).toBe(false);
  });
});

describe('ssbj_report_versions の不変性', () => {
  it('UPDATE をトリガーで拒否する', () => {
    expect(body).toMatch(
      /create trigger \w+ before update on ssbj_report_versions for each row execute function reject_ssbj_report_version_update\(\);/,
    );
    expect(functionBody('reject_ssbj_report_version_update')).toContain('raise exception');
  });

  it('版番号はレポート内で一意', () => {
    expect(body).toContain('unique ("reportId", "versionNumber")');
  });
});

describe('create_ssbj_report_version', () => {
  const rpc = functionBody('create_ssbj_report_version');

  it('EXECUTE は service_role 限定', () => {
    expect(body).toMatch(
      /revoke execute on function create_ssbj_report_version\([^)]*\) from public, anon, authenticated;/,
    );
    expect(body).toMatch(/grant execute on function create_ssbj_report_version\([^)]*\) to service_role;/);
    expect(grants.some(grant => /create_ssbj_report_version/.test(grant) && /\bauthenticated\b/.test(grant))).toBe(
      false,
    );
  });

  it('レポート行をロックし、組織帰属を確かめる', () => {
    expect(rpc).toMatch(/from ssbj_reports where id = p_report_id for update;/);
    expect(rpc).toContain('v_report."organizationId" <> p_organization_id');
  });

  it('draftRevision の不一致は競合の SQLSTATE で中止する（アプリ側の定数と一致）', () => {
    expect(rpc).toContain('v_report."draftRevision" <> p_expected_draft_revision');
    expect(rpc).toContain(`errcode = '${SSBJ_VERSION_SQLSTATE.draftRevisionConflict}'`);
    expect(rpc).toContain(`errcode = '${SSBJ_VERSION_SQLSTATE.reportInvalid}'`);
  });
});

describe('bump_ssbj_draft_revision', () => {
  it('security definer かつ search_path を空にする（関数すり替えの防止）', () => {
    const fn = functionBody('bump_ssbj_draft_revision');
    expect(fn).toContain('security definer');
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain('update public.ssbj_reports');
  });
});
