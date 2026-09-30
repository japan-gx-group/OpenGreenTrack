// SSBJ の OGT 採用値（ssbj_ogt_adoptions）の RLS・権限・採用 RPC・保存版連携に対する回帰テスト
// （実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - 改ざん防止: authenticated は select と delete（取り消し）だけ。insert / update の権限もポリシーも無い
//   - 書き込みは service_role 限定の adopt_ssbj_ogt_values だけで、組織・年度の一致を RPC 内で検証する
//   - 組織分離（§10 の手順1）と、作業中データの変更で draftRevision を進めること（手順2）
//   - 保存版セクション関数は service_role 限定（手順3）

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_ogt_adoptions.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_ogt_adoptions のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy => /\bon ssbj_ogt_adoptions\b/.test(policy));
const grants = body.match(/grant [^;]*;/g) ?? [];

const functionBody = (name: string): string => {
  const match = body.match(new RegExp(`create function ${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`));
  if (!match) throw new Error(`${name} が見つかりません`);
  return match[1];
};

describe('ssbj_ogt_adoptions の RLS と権限（改ざん防止）', () => {
  it('RLS を有効化し、select と delete だけを自組織に許す', () => {
    expect(body).toContain('alter table ssbj_ogt_adoptions enable row level security;');
    expect(policies).toHaveLength(2);
    for (const command of ['select', 'delete']) {
      const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
      expect(policy, command).toBeDefined();
      expect(policy).toContain('to authenticated');
      expect(policy).toContain('"organizationId" = (select current_user_organization_id())');
    }
  });

  it('authenticated には insert / update を付与しない（値をクライアントから書けない）', () => {
    const tableGrants = grants.filter(grant => /\bon ssbj_ogt_adoptions\b/.test(grant));
    expect(tableGrants).toEqual(['grant select, delete on ssbj_ogt_adoptions to authenticated;']);
    expect(policies.some(policy => /\bfor (insert|update|all)\b/.test(policy))).toBe(false);
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\bssbj_ogt_adoptions\b/.test(grant) && /\banon\b/.test(grant))).toBe(false);
  });

  it('レポートごとに 1 行で、採用値・参考値は配列', () => {
    expect(body).toContain('"reportId" uuid not null unique references ssbj_reports(id) on delete cascade');
    expect(body).toContain(`check (jsonb_typeof("adoptedValues") = 'array')`);
    expect(body).toContain(`check (jsonb_typeof("supplierReferences") = 'array')`);
  });

  it('作業中データの変更で draftRevision を進める', () => {
    expect(body).toMatch(
      /create trigger \w+ after insert or update or delete on ssbj_ogt_adoptions for each row execute function bump_ssbj_draft_revision\(\);/,
    );
  });
});

describe('採用 RPC adopt_ssbj_ogt_values', () => {
  const signature = 'adopt_ssbj_ogt_values\\(uuid, uuid, uuid, jsonb, jsonb\\)';

  it('service_role 限定', () => {
    expect(body).toMatch(new RegExp(`revoke execute on function ${signature} from public, anon, authenticated;`));
    expect(body).toMatch(new RegExp(`grant execute on function ${signature} to service_role;`));
  });

  it('レポートの組織と、候補値・参考値の年度がレポートと一致することを検証する', () => {
    const rpc = functionBody('adopt_ssbj_ogt_values');
    expect(rpc).toContain('where id = p_report_id and "organizationId" = p_organization_id;');
    expect(rpc).toContain(`using errcode = 'P2041'`);
    expect(rpc).toContain(`item.value ->> 'fiscalYearId' is distinct from v_fiscal_year_id::text`);
    expect(rpc).toContain(`using errcode = 'P2042'`);
  });

  it('採用日時・採用者は RPC が付け、採用し直すと置き換える', () => {
    const rpc = functionBody('adopt_ssbj_ogt_values');
    expect(rpc).toContain(`jsonb_build_object('adoptedAt', v_adopted_at, 'adoptedBy', p_actor_user_id)`);
    expect(rpc).toContain('on conflict ("reportId") do update set');
  });
});

describe('保存版との連携', () => {
  it('ssbj_snapshot_section__ghg は service_role 限定', () => {
    expect(body).toContain('create function ssbj_snapshot_section__ghg(p_report_id uuid)');
    expect(body).toContain('revoke execute on function ssbj_snapshot_section__ghg(uuid) from public, anon, authenticated;');
    expect(body).toContain('grant execute on function ssbj_snapshot_section__ghg(uuid) to service_role;');
  });

  it('採用値・参考値・採用日時・採用者を SsbjGhgAdoption の形で返す', () => {
    const section = functionBody('ssbj_snapshot_section__ghg');
    for (const key of ['adoptedAt', 'adoptedBy', 'values', 'supplierReferences']) {
      expect(section).toContain(`'${key}'`);
    }
  });
});
