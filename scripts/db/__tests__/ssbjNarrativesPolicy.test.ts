// SSBJ 四本柱・補足の文章（ssbj_narratives）の制約・RLS・権限・保存版連携に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - 組織分離（§10 の手順1）と、作業中データの変更で draftRevision を進めること（手順2）
//   - 項目 ID の形式・状態と本文の対の制約、レポートと項目の組ごとに 1 行
//   - レポート・組織・項目は作成後に変えない（update の列 GRANT に含めない）
//   - 保存版セクション関数は service_role 限定（手順3）

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_ITEM_ID_PATTERN } from '@/features/ssbj/utils/ids';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_narratives.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_narratives のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const policies = (body.match(/create policy[^;]*;/g) ?? []).filter(policy => /\bon ssbj_narratives\b/.test(policy));
const grants = body.match(/grant [^;]*;/g) ?? [];

const policyFor = (command: string): string => {
  const policy = policies.find(text => new RegExp(`\\bfor ${command}\\b`).test(text));
  if (!policy) throw new Error(`${command} のポリシーがありません`);
  return policy;
};

describe('ssbj_narratives の制約', () => {
  it('項目 ID の形式は utils/ids.ts と同じ正規表現', () => {
    const match = body.match(/"itemId" ~ '([^']+)'/);
    expect(match?.[1]).toBe(SSBJ_ITEM_ID_PATTERN.source);
  });

  it('入力済みのときだけ本文を持ち、空白だけの本文は拒否する', () => {
    expect(body).toContain(`("disclosureState" = 'answered' and "disclosureText" is not null and btrim("disclosureText") <> '')`);
    expect(body).toContain(`("disclosureState" <> 'answered' and "disclosureText" is null)`);
  });

  it('レポートと項目の組ごとに 1 行', () => {
    expect(body).toContain('constraint ssbj_narratives_report_item_key unique ("reportId", "itemId")');
  });
});

describe('ssbj_narratives の RLS と権限', () => {
  it('RLS を有効化している', () => {
    expect(body).toContain('alter table ssbj_narratives enable row level security;');
  });

  it.each(['select', 'insert', 'update', 'delete'])('%s は authenticated の自組織に限定される', command => {
    const policy = policyFor(command);
    expect(policy).toContain('to authenticated');
    expect(policy).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it.each(['insert', 'update'])('%s の with check でレポートの組織帰属を検証する', command => {
    const withCheck = policyFor(command).split('with check')[1] ?? '';
    expect(withCheck).toContain('select 1 from ssbj_reports r where r.id = "reportId"');
  });

  it('update は文章の列だけ（レポート・組織・項目は作成後に変えられない）', () => {
    const updateGrant = grants.find(grant => grant.startsWith('grant update') && /\bon ssbj_narratives\b/.test(grant));
    expect(updateGrant).toBeDefined();
    for (const column of ['"reportId"', '"organizationId"', '"itemId"']) {
      expect(updateGrant).not.toContain(column);
    }
  });

  it('anon には何も付与しない', () => {
    expect(grants.some(grant => /\bssbj_narratives\b/.test(grant) && /\banon\b/.test(grant))).toBe(false);
  });

  it('作業中データの変更で draftRevision を進める', () => {
    expect(body).toMatch(
      /create trigger \w+ after insert or update or delete on ssbj_narratives for each row execute function bump_ssbj_draft_revision\(\);/,
    );
  });
});

describe('保存版との連携', () => {
  it('ssbj_snapshot_section__narratives は service_role 限定', () => {
    expect(body).toContain('create function ssbj_snapshot_section__narratives(p_report_id uuid)');
    expect(body).toContain('revoke execute on function ssbj_snapshot_section__narratives(uuid) from public, anon, authenticated;');
    expect(body).toContain('grant execute on function ssbj_snapshot_section__narratives(uuid) to service_role;');
  });

  it('開示する文章と内部メモを別のプロパティにする（§5）', () => {
    expect(body).toContain(`'disclosure', ssbj_field_value_json(n."disclosureState", n."disclosureText")`);
    expect(body).toContain(`'internalNote', n."internalNote"`);
  });
});
