// SSBJ の操作履歴（ssbj_audit_logs）・承認ロック・復元の、取り付け漏れと権限に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - SSBJ の作業中データのテーブル（draftRevision を進めるテーブル）すべてに、操作履歴のトリガーと承認ロックのトリガーが付いている
//     （機能を足したときに付け忘れると、履歴が残らない・承認済みでも変えられる穴になる）
//   - 保存版のセクション（ssbj_snapshot_section__<key>）すべてに、復元の関数（ssbj_restore_section__<key>）がある
//   - 操作履歴は閲覧だけ（書き込みはトリガー・RPC・出力の記録の関数だけ）で、書き換えはトリガーで全ロール拒否
//   - 操作の種類が types.ts と一致する

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_AUDIT_ACTIONS, SSBJ_EXPORT_FORMATS } from '@/features/ssbj/types';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const normalize = (sql: string): string =>
  sql.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');

const all = normalize(readdirSync(migrationsDir).sort().map(name => readFileSync(path.join(migrationsDir, name), 'utf8')).join('\n'));
const migration = (suffix: string): string => {
  const name = readdirSync(migrationsDir).find(file => file.endsWith(suffix));
  if (!name) throw new Error(`${suffix} のマイグレーションが見つかりません`);
  return normalize(readFileSync(path.join(migrationsDir, name), 'utf8'));
};
const audit = migration('_ssbj_audit_logs.sql');

/** draftRevision を進める（= SSBJ の作業中データの）テーブル。 */
const workingTables = [...all.matchAll(
  /create trigger \w+ after insert or update or delete on (ssbj_\w+) for each row execute function bump_ssbj_draft_revision\(\);/g,
)].map(match => match[1]);

describe('取り付け漏れが無い', () => {
  it('作業中データのテーブルを見つけられている（前提の確認）', () => {
    expect(workingTables).toEqual(expect.arrayContaining([
      'ssbj_risks_opportunities', 'ssbj_report_time_horizons', 'ssbj_evidence', 'ssbj_ogt_adoptions',
      'ssbj_narratives', 'ssbj_judgements',
    ]));
  });

  it.each(workingTables)('%s に操作履歴のトリガーが付いている', table => {
    expect(all).toMatch(new RegExp(
      `create trigger \\w+ after insert or update or delete on ${table} for each row execute function ssbj_audit_row_change\\(`,
    ));
  });

  it.each(workingTables)('%s に承認ロックのトリガーが付いている', table => {
    expect(all).toMatch(new RegExp(
      `create trigger \\w+ before insert or update or delete on ${table} for each row execute function reject_ssbj_change_when_approved\\(\\);`,
    ));
  });

  it('レポート本体と保存版の作成も操作履歴に残す', () => {
    expect(audit).toContain('after insert or update on ssbj_reports for each row execute function ssbj_audit_row_change(');
    expect(audit).toContain('after insert on ssbj_report_versions for each row execute function ssbj_audit_row_change(');
  });

  it('保存版のセクションすべてに、復元の関数がある', () => {
    const sections = [...new Set([...all.matchAll(/create (?:or replace )?function ssbj_snapshot_section__(\w+)\(/g)].map(match => match[1]))];
    const restorers = [...new Set([...all.matchAll(/create (?:or replace )?function ssbj_restore_section__(\w+)\(/g)].map(match => match[1]))];
    expect(sections.length).toBeGreaterThan(5);
    expect(restorers.sort()).toEqual(sections.sort());
  });
});

describe('ssbj_audit_logs の権限', () => {
  it('RLS を有効化し、自組織の閲覧だけを許す', () => {
    expect(audit).toContain('alter table ssbj_audit_logs enable row level security;');
    expect(audit).toContain('for select to authenticated using ("organizationId" = (select current_user_organization_id()))');
    const policies = audit.match(/create policy[^;]*on ssbj_audit_logs[^;]*;/g) ?? [];
    expect(policies).toHaveLength(1);
  });

  it('authenticated には select だけを付与する（insert・update・delete は与えない）', () => {
    const grants = (audit.match(/grant [^;]*;/g) ?? []).filter(grant => /\bon ssbj_audit_logs\b/.test(grant));
    expect(grants).toEqual(['grant select on ssbj_audit_logs to authenticated;']);
  });

  it('書き換えはトリガーで全ロール拒否する', () => {
    expect(audit).toContain('before update on ssbj_audit_logs for each row execute function reject_ssbj_audit_log_update();');
  });

  it('出力の記録の関数は authenticated から呼べ、自組織のレポートだけを記録する', () => {
    expect(audit).toContain('grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;');
    expect(audit).toContain('r."organizationId" = public.current_user_organization_id()');
  });

  it('操作の種類・出力形式は types.ts と同じ', () => {
    const actions = audit.match(/check \( action in \(([^)]*)\) \)/)?.[1].split(',').map(value => value.trim().replace(/'/g, ''));
    expect(actions).toEqual([...SSBJ_AUDIT_ACTIONS]);
    const formats = audit.match(/if p_format not in \(([^)]*)\)/)?.[1].split(',').map(value => value.trim().replace(/'/g, ''));
    expect(formats).toEqual([...SSBJ_EXPORT_FORMATS]);
  });

  it('レポートの削除に伴う連鎖削除では記録しない（記録先の外部キーが消えるレポートを指すため）', () => {
    expect(audit).toContain('if not exists (select 1 from public.ssbj_reports r where r.id = v_report_id) then return null;');
  });
});
