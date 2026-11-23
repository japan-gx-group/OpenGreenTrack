// SSBJ の削減目標の採用（supabase/migrations/*_ssbj_reduction_target_adoption.sql。R2-32）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 動作（採用・保存版・復元）はローカル DB で確かめ、ここでは取り違えると穴になる文面を固定する。
//
// 固定すること:
//   - 書き込みは引き続き service_role 限定の adopt_ssbj_ogt_values だけ（authenticated に insert / update を与えない）
//   - 古い形（引数 5 つ）の採用 RPC を消し、同じ名前の関数を 2 つ残さない
//   - 削減目標の読み取りは security invoker（組織の RLS が効く）で、anon には与えない
//   - 保存版・復元が削減目標を運ぶ

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const normalize = (sql: string): string =>
  sql.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
const files = readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
const name = files.find(file => file.endsWith('_ssbj_reduction_target_adoption.sql'));
if (!name) throw new Error('削減目標の採用のマイグレーションが見つかりません');
const body = normalize(readFileSync(path.join(migrationsDir, name), 'utf8'));
// このマイグレーションより後で、採用 RPC・保存版・復元の関数を置き換えていないか（置き換えたら、このテストも見直す）。
const later = files.slice(files.indexOf(name) + 1).map(file => normalize(readFileSync(path.join(migrationsDir, file), 'utf8'))).join(' ');

const functionBody = (fn: string): string => {
  const match = body.match(new RegExp(`create (?:or replace )?function ${fn}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`));
  if (!match) throw new Error(`${fn} が見つかりません`);
  return match[1];
};

describe('削減目標の採用（R2-32）', () => {
  it('列は null（この列を足す前の採用）か、status が set / not_set のオブジェクト', () => {
    expect(body).toContain('alter table ssbj_ogt_adoptions add column "reductionTarget" jsonb;');
    expect(body).toContain(`"reductionTarget" ->> 'status' in ('set', 'not_set')`);
  });

  it('authenticated に ssbj_ogt_adoptions への insert / update を与えない（値をクライアントから書けない）', () => {
    const grants = (body.match(/grant [^;]*;/g) ?? []).filter(grant => /\bon ssbj_ogt_adoptions\b/.test(grant));
    expect(grants).toEqual([]);
  });

  it('古い形の採用 RPC を消し、新しい形は service_role 限定', () => {
    expect(body).toContain('drop function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb);');
    expect(body).toContain('revoke execute on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;');
    expect(body).toContain('grant execute on function adopt_ssbj_ogt_values(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;');
  });

  it('採用 RPC は作業中データの行を先にロックし、削減目標がレポートの年度のものかを確かめる', () => {
    const rpc = functionBody('adopt_ssbj_ogt_values');
    expect(rpc).toContain('perform lock_ssbj_report_working_rows(p_report_id);');
    expect(rpc).toContain(`p_reduction_target -> 'reportYear' ->> 'fiscalYearId' is distinct from v_fiscal_year_id::text`);
    expect(rpc).toContain('"reductionTarget" = excluded."reductionTarget"');
  });

  it('削減目標の読み取りは security invoker で、anon には与えない', () => {
    expect(body).toContain('create function ssbj_ogt_reduction_target(p_fiscal_year_id uuid) returns jsonb language sql stable security invoker');
    expect(body).toContain('revoke execute on function ssbj_ogt_reduction_target(uuid) from public, anon;');
    expect(body).toContain('grant execute on function ssbj_ogt_reduction_target(uuid) to authenticated, service_role;');
  });

  it('目標排出量は numeric のまま計算し、確定した集計（dashboard_aggregates）の年度だけを排出量にする', () => {
    const reader = functionBody('ssbj_ogt_reduction_target');
    expect(reader).toContain(`trim_scale(b.total * (100 - y."reductionPercent") / 100)::text`);
    expect(reader).toContain('join dashboard_aggregates da');
    expect(reader).not.toMatch(/::(float|double|real)/);
  });

  it('保存版は削減目標を載せ（この列を足す前の採用はキーを出さない）、復元は版の値をそのまま戻す', () => {
    expect(functionBody('ssbj_snapshot_section__ghg')).toContain(`jsonb_build_object('reductionTarget', a."reductionTarget")`);
    expect(functionBody('ssbj_restore_section__ghg')).toContain(`p_section -> 'reductionTarget'`);
    expect(body).toContain('grant execute on function ssbj_snapshot_section__ghg(uuid) to service_role;');
    expect(body).toContain('grant execute on function ssbj_restore_section__ghg(uuid, uuid, uuid, jsonb) to service_role;');
  });

  it('後のマイグレーションで、採用 RPC・保存版・復元の関数を置き換えていない', () => {
    expect(later).not.toMatch(/function (adopt_ssbj_ogt_values|ssbj_snapshot_section__ghg|ssbj_restore_section__ghg)\(/);
  });
});
