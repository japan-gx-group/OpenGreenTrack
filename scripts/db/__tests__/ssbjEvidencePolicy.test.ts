// SSBJ 根拠文書テーブルの組織分離と保存版登録契約を確認する机上検証。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260929150000_ssbj_evidence.sql'), 'utf8',
).split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');

describe('ssbj_evidence の権限と保存版', () => {
  it('RLSが組織を分離し、書き込みではレポートの組織帰属も確認する', () => {
    expect(sql).toContain('alter table ssbj_evidence enable row level security;');
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`on ssbj_evidence for ${operation} to authenticated`));
    }
    expect(sql.match(/exists \( select 1 from ssbj_reports r where r\.id = "reportId" and r\."organizationId" = \(select current_user_organization_id\(\)\) \)/g)).toHaveLength(2);
    expect(sql).toContain('"organizationId" = (select current_user_organization_id())');
  });

  it('レポートと組織の付け替えを許さず、変更時に版数を進める', () => {
    const updateGrant = sql.match(/grant update \([^;]+\) on ssbj_evidence to authenticated;/)?.[0];
    expect(updateGrant).toBeDefined();
    expect(updateGrant).not.toContain('"reportId"');
    expect(updateGrant).not.toContain('"organizationId"');
    expect(sql).toContain('after insert or update or delete on ssbj_evidence');
    expect(sql).toContain('execute function bump_ssbj_draft_revision()');
  });

  it('保存版関数はservice_roleのみが実行でき、内部保管先と開示文を別プロパティにする', () => {
    expect(sql).toContain('create function ssbj_snapshot_section__evidence(p_report_id uuid) returns jsonb');
    expect(sql).toContain('revoke execute on function ssbj_snapshot_section__evidence(uuid) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function ssbj_snapshot_section__evidence(uuid) to service_role;');
    expect(sql).toContain("'internalLocation', e.\"internalLocation\"");
    expect(sql).toContain("'disclosure', case when e.\"disclosureState\"");
  });
});
