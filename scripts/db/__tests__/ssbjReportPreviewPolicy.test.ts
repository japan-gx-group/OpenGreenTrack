// SSBJ レポートのプレビュー（作業中の内容を保存版と同じ形で組み立てる）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - スナップショットの組み立ては ssbj_build_report_snapshot の 1 か所で、版生成 RPC もプレビューもそれを使う
//   - 置き換えた版生成 RPC に、ロック・組織帰属・競合検知・採番が残っている
//   - 組み立て関数・プレビュー RPC は service_role 限定で、プレビューは組織の一致を検証する

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_VERSION_SQLSTATE } from '@/features/ssbj/services/versionServer';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const fileName = readdirSync(migrationsDir).find(name => name.endsWith('_ssbj_report_preview.sql'));

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const body = (() => {
  if (!fileName) throw new Error('ssbj_report_preview のマイグレーションが見つかりません');
  return readFileSync(path.join(migrationsDir, fileName), 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');
})();

const functionBody = (name: string): string => {
  const match = body.match(new RegExp(`create (?:or replace )?function ${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`));
  if (!match) throw new Error(`${name} が見つかりません`);
  return match[1];
};

const serviceRoleOnly = (signature: string) => {
  const escaped = signature.replace(/[()]/g, '\\$&');
  expect(body).toMatch(new RegExp(`revoke execute on function ${escaped} from public, anon, authenticated;`));
  expect(body).toMatch(new RegExp(`grant execute on function ${escaped} to service_role;`));
};

describe('ssbj_build_report_snapshot', () => {
  const builder = functionBody('ssbj_build_report_snapshot');

  it('service_role 限定', () => {
    serviceRoleOnly('ssbj_build_report_snapshot(uuid)');
  });

  it('各機能の保存版セクション関数を名前で自動収集する（§10）', () => {
    expect(builder).toContain(`p.proname like 'ssbj\\_snapshot\\_section\\_\\_%' escape '\\'`);
    expect(builder).toContain(`coalesce(v_section, 'null'::jsonb)`);
  });

  it('report に基本情報の全項目と年度の表記を入れ、持分比率は文字列にする', () => {
    for (const key of [
      'title', 'purpose', 'reportingScope', 'standardVersion', 'parentCompanyName', 'parentRelationship',
      'measurementApproach', 'industryCode', 'fiscalYearLabel', 'periodStart', 'periodEnd',
    ]) {
      expect(builder).toContain(`'${key}'`);
    }
    expect(builder).toContain(`'ownershipPercentage', v_report."ownershipPercentage"::text`);
    expect(builder).toContain(`'schemaVersion', 1`);
  });
});

describe('create_ssbj_report_version（組み立て関数を使う形に置き換え）', () => {
  const rpc = functionBody('create_ssbj_report_version');

  it('スナップショットを組み立て関数で作る（組み立てを 2 か所に書かない）', () => {
    expect(rpc).toContain('v_snapshot := ssbj_build_report_snapshot(p_report_id);');
    expect(rpc).not.toContain('ssbj_snapshot_section__');
  });

  it('ロック・組織帰属・競合検知・復元元の確認・採番が残っている', () => {
    expect(rpc).toMatch(/from ssbj_reports where id = p_report_id for update;/);
    expect(rpc).toContain('v_report."organizationId" <> p_organization_id');
    expect(rpc).toContain('v_report."draftRevision" <> p_expected_draft_revision');
    expect(rpc).toContain(`errcode = '${SSBJ_VERSION_SQLSTATE.draftRevisionConflict}'`);
    expect(rpc).toContain(`errcode = '${SSBJ_VERSION_SQLSTATE.reportInvalid}'`);
    expect(rpc).toContain('where id = p_source_version_id and "reportId" = p_report_id;');
    expect(rpc).toContain('coalesce(max("versionNumber"), 0) + 1');
  });

  it('service_role 限定のまま', () => {
    serviceRoleOnly('create_ssbj_report_version(uuid, uuid, uuid, integer, text, uuid)');
  });
});

describe('preview_ssbj_report', () => {
  const preview = functionBody('preview_ssbj_report');

  it('service_role 限定で、組織の一致を検証してから組み立てる（保存はしない）', () => {
    serviceRoleOnly('preview_ssbj_report(uuid, uuid)');
    expect(preview).toContain('where id = p_report_id and "organizationId" = p_organization_id;');
    expect(preview).toContain(`errcode = '${SSBJ_VERSION_SQLSTATE.reportInvalid}'`);
    expect(preview).toContain(`'snapshot', ssbj_build_report_snapshot(p_report_id)`);
    expect(preview).not.toMatch(/\binsert\b/);
  });
});
