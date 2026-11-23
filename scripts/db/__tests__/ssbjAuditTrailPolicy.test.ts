// SSBJ の証跡一式（supabase/migrations/*_ssbj_audit_trail.sql。R2-33）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 固定すること:
//   - 明細の読み取りは security invoker（組織の RLS が効く）で、anon には与えない
//   - 明細の範囲が OGT の集計（refresh_dashboard_aggregates）と同じ（年度帰属は periodStart、Scope 3 は方式ごとの採用値）
//   - 数値は numeric を text にして返す（number に変換しない）
//   - 閲覧者は証跡一式を記録できない（= 出力できない）

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const normalize = (sql: string): string =>
  sql.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
const name = readdirSync(migrationsDir).find(file => file.endsWith('_ssbj_audit_trail.sql'));
if (!name) throw new Error('証跡一式のマイグレーションが見つかりません');
const body = normalize(readFileSync(path.join(migrationsDir, name), 'utf8'));
const reader = body.match(/create function ssbj_audit_trail_details\(p_fiscal_year_id uuid\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? '';

describe('証跡一式（R2-33）', () => {
  it('明細の読み取りは security invoker で、anon には与えない', () => {
    expect(body).toContain('create function ssbj_audit_trail_details(p_fiscal_year_id uuid) returns jsonb language sql stable security invoker');
    expect(body).toContain('revoke execute on function ssbj_audit_trail_details(uuid) from public, anon;');
    expect(body).toContain('grant execute on function ssbj_audit_trail_details(uuid) to authenticated, service_role;');
  });

  it('明細の範囲は OGT の集計と同じ（年度帰属は periodStart、Scope 3 は方式ごとの採用値。方式の既定は直接入力）', () => {
    expect(reader).toContain('ar."periodStart" between fy."startDate" and fy."endDate"');
    expect(reader).toContain(`coalesce(m.method, 'direct'::"Scope3Method")`);
    expect(reader).toContain(`r.scope in ('scope1', 'scope2')`);
    expect(reader).toContain(`m.method = 'calculated'`);
    expect(reader).toContain(`m.method = 'direct'`);
  });

  it('排出量・活動量・係数は numeric を text にして返す', () => {
    for (const column of ['c.emissions::text', 'c.amount::text', 'c."appliedFactorValue"::text', 'b.emissions::text', 'd.emissions::text', 'ef."factorValue"::text']) {
      expect(reader).toContain(column);
    }
    expect(reader).not.toMatch(/::(float|double|real)/);
  });

  it('閲覧者は証跡一式を記録できない（CSV・Excel・印刷だけ）', () => {
    expect(body).toContain(`if p_format not in ('csv', 'xlsx', 'audit_csv', 'audit_xlsx', 'print', 'trail_xlsx') then`);
    expect(body).toContain(`if not public.ssbj_current_user_can_view_working() and ( p_format not in ('csv', 'xlsx', 'print')`);
    expect(body).toContain('grant execute on function record_ssbj_export(uuid, text, uuid) to authenticated;');
  });
});
