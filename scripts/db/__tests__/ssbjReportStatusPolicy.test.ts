// SSBJ レポートの状態管理と承認ロック（supabase/migrations/*_ssbj_report_status.sql）と、
// 保存版の復元（*_ssbj_restore_version.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 動作（権限・遷移・ロック・復元の結果）はローカル DB で確かめ、ここでは取り違えると穴になる文面を固定する。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_REPORT_STATUSES, SSBJ_REPORT_STATUS_ACTIONS } from '@/features/ssbj/types';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const migration = (suffix: string): string => {
  const name = readdirSync(migrationsDir).find(file => file.endsWith(suffix));
  if (!name) throw new Error(`${suffix} のマイグレーションが見つかりません`);
  return readFileSync(path.join(migrationsDir, name), 'utf8')
    .split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
};
const status = migration('_ssbj_report_status.sql');
const restore = migration('_ssbj_restore_version.sql');

describe('状態管理と承認ロック', () => {
  it('状態の値は types.ts と同じ', () => {
    const values = status.match(/check \(status in \(([^)]*)\)\)/)?.[1].split(',').map(value => value.trim().replace(/'/g, ''));
    expect(values).toEqual([...SSBJ_REPORT_STATUSES]);
  });

  it('RPC は types.ts の操作をすべて扱い、それ以外は拒否する', () => {
    for (const action of SSBJ_REPORT_STATUS_ACTIONS) {
      expect(status).toContain(`p_action = '${action}'`);
    }
    expect(status).toContain(`raise exception '状態の操作が不正です: %', p_action using errcode = 'P2054'`);
  });

  it('承認・差戻しは、指定された承認者か OGT の管理者だけ', () => {
    expect(status).toContain(`v_is_privileged := v_actor_role = 'admin' or p_actor_user_id = v_report."approverUserId";`);
    expect(status.match(/if not v_is_privileged then/g)).toHaveLength(2);
  });

  it('承認は、画面が見ていた draftRevision と一致したときだけ（見ていない内容を承認させない）', () => {
    const conflictCheck = status.indexOf('if v_report."draftRevision" <> p_expected_draft_revision then');
    expect(conflictCheck).toBeGreaterThan(0);
    expect(conflictCheck).toBeLessThan(status.indexOf("if p_action = 'submit' then"));
  });

  it('承認するときは、その時点の内容で保存版を作る', () => {
    expect(status).toContain("create_ssbj_report_version( p_report_id, p_organization_id, p_actor_user_id, p_expected_draft_revision, '承認時の保存版', null )");
  });

  it('状態の変更 RPC は service_role 限定（利用者は状態の列を直接変えられない）', () => {
    expect(status).toContain('revoke execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) from public, anon, authenticated;');
    expect(status).toContain('grant execute on function change_ssbj_report_status(uuid, uuid, uuid, text, integer, uuid, text) to service_role;');
    expect(status).not.toMatch(/grant update \([^)]*status/);
  });

  it('承認済みの間は基本情報の変更も拒否する（基本情報の更新トリガーより先に走る名前にする）', () => {
    expect(status).toContain('create trigger a_reject_ssbj_reports_basic_info_when_approved before update on ssbj_reports');
    expect(status).toContain("errcode = 'P2051'");
  });
});

describe('保存版の復元', () => {
  it('承認済み・競合のときは何も変えずに止める', () => {
    expect(restore).toContain("if v_report.status = 'approved' then");
    expect(restore).toContain('if v_report."draftRevision" <> p_expected_draft_revision then');
  });

  it('復元できないセクションを含む版は、作業中データを変える前に止める', () => {
    expect(restore.indexOf("errcode = 'P2055'", restore.indexOf('jsonb_object_keys')))
      .toBeLessThan(restore.indexOf('create_ssbj_report_version('));
  });

  it('戻す前の作業中の内容を保存版として残してから戻す', () => {
    expect(restore.indexOf('v_backup := create_ssbj_report_version(')).toBeLessThan(restore.indexOf("execute format('select %I($1, $2, $3, $4)'"));
  });

  it('行ごとの操作履歴は止め、復元として 1 件だけ記録する', () => {
    expect(restore).toContain("perform set_config('ssbj.suppress_audit', 'on', true);");
    expect(restore).toContain("'version_restore'");
  });

  it('復元の RPC とセクションごとの関数は service_role 限定', () => {
    expect(restore).toContain('revoke execute on function restore_ssbj_report_version(uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;');
    for (const match of restore.matchAll(/create function (ssbj_restore_section__\w+)\(/g)) {
      expect(restore).toContain(`revoke execute on function ${match[1]}(uuid, uuid, uuid, jsonb) from public, anon, authenticated;`);
    }
  });
});
