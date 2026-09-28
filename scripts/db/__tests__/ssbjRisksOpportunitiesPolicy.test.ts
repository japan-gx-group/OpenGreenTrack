// SSBJ リスク・機会（ssbj_risks_opportunities）の RLS・権限・保存版連携に対する回帰テスト
// （実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること（docs/ssbj-spec.md §10 の登録規約）:
//   - 組織分離: select / insert / update / delete が自組織に限定され、insert / update はレポートの組織帰属を exists で検証する
//   - 作成後にレポート・組織を付け替えられない: update の列 GRANT に reportId / organizationId が無い
//   - 作業中データの変更で draftRevision を進める: bump_ssbj_draft_revision を AFTER INSERT / UPDATE / DELETE で付ける
//   - 保存版への取り込み: ssbj_snapshot_section__risks_opportunities があり、EXECUTE は service_role 限定
//   - 関連先の形式: check 制約の正規表現が utils/ids.ts の章 ID と同じ章を使う

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_SECTION_IDS } from '@/features/ssbj/types';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_risks_opportunities.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_risks_opportunities のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy =>
  /\bon ssbj_risks_opportunities\b/.test(policy),
);
const grants = (body.match(/grant [^;]*;/g) ?? []).filter(grant => /\bon ssbj_risks_opportunities\b/.test(grant));

const policyFor = (command: string): string => {
  const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
  if (!policy) throw new Error(`${command} のポリシーがありません`);
  return policy;
};

const REPORT_CHECK =
  /exists \( select 1 from ssbj_reports r where r\.id = "reportId" and r\."organizationId" = \(select current_user_organization_id\(\)\) \)/;

describe('ssbj_risks_opportunities の RLS', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_risks_opportunities enable row level security;');
  });

  it.each(['select', 'insert', 'update', 'delete'])('%s は authenticated の自組織に限定される', command => {
    const policy = policyFor(command);
    expect(policy).toContain('to authenticated');
    expect(policy).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it.each(['insert', 'update'])('%s の with check でレポートの組織帰属を検証する', command => {
    const withCheck = policyFor(command).split('with check')[1] ?? '';
    expect(withCheck).toMatch(REPORT_CHECK);
  });
});

describe('ssbj_risks_opportunities の GRANT', () => {
  it('update は内容の列だけ（レポート・組織は作成後に変えられない）', () => {
    const updateGrant = grants.find(grant => grant.startsWith('grant update'));
    expect(updateGrant).toBeDefined();
    expect(updateGrant).not.toContain('"reportId"');
    expect(updateGrant).not.toContain('"organizationId"');
    expect(updateGrant).toContain('"linkTargets"');
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\banon\b/.test(grant))).toBe(false);
  });
});

describe('保存版との連携', () => {
  it('作業中データの変更で draftRevision を進める', () => {
    expect(body).toMatch(
      /create trigger \w+ after insert or update or delete on ssbj_risks_opportunities for each row execute function bump_ssbj_draft_revision\(\);/,
    );
  });

  it('保存版セクション関数は service_role 限定', () => {
    expect(body).toContain('create function ssbj_snapshot_section__risks_opportunities(p_report_id uuid) returns jsonb');
    expect(body).toMatch(
      /revoke execute on function ssbj_snapshot_section__risks_opportunities\(uuid\) from public, anon, authenticated;/,
    );
    expect(body).toMatch(/grant execute on function ssbj_snapshot_section__risks_opportunities\(uuid\) to service_role;/);
  });
});

describe('関連先の形式', () => {
  it('check 制約の章の並びが SSBJ_SECTION_IDS と一致する', () => {
    const sections = `(${SSBJ_SECTION_IDS.join('|')})`;
    expect(body).toContain(`'^${sections}(\\.[a-z0-9_]+)?(,${sections}(\\.[a-z0-9_]+)?)*$'`);
  });

  it('NULL 要素を拒否する（array_to_string は NULL を読み飛ばすため）', () => {
    expect(body).toContain('array_position("linkTargets", null) is null');
  });
});
