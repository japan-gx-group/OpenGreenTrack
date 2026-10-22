// 外部で算定した排出量（supabase/migrations/*_ssbj_external_emissions.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 動作（必須項目・二重計上の拒否・保存版と復元）はローカル DB で確かめ、ここでは取り違えると穴になる文面を固定する。
// §10 の手順 2・3・6・7・8 の付け忘れ・ロールのポリシーの付け忘れは、ssbjAuditLogsPolicy.test.ts と
// ssbjRolePoliciesPolicy.test.ts が、すべての作業中データのテーブルについて検出する。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SSBJ_EXTERNAL_EMISSION_SQLSTATE } from '@/features/ssbj/services/externalEmissionService';
import { SSBJ_OGT_ADOPTION_SQLSTATE } from '@/features/ssbj/services/ogtAdoptionServer';
import { SSBJ_GHG_GASES, SSBJ_SCOPE2_BASES } from '@/features/ssbj/types';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');
const migration = (suffix: string): string => {
  const name = readdirSync(migrationsDir).find(file => file.endsWith(suffix));
  if (!name) throw new Error(`${suffix} のマイグレーションが見つかりません`);
  return readFileSync(path.join(migrationsDir, name), 'utf8')
    .split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');
};
const external = migration('_ssbj_external_emissions.sql');
const scope2Overlap = migration('_ssbj_scope2_basis_overlap.sql');

describe('値の制約', () => {
  it('対象ガス・Scope 2 の基準の値は types.ts と同じ', () => {
    const gases = external.match(/gases <@ array\[([^\]]*)\]/)?.[1].split(',').map(value => value.trim().replace(/'/g, ''));
    expect(gases).toEqual([...SSBJ_GHG_GASES]);
    const bases = external.match(/"scope2Basis" in \(([^)]*)\)/)?.[1].split(',').map(value => value.trim().replace(/'/g, ''));
    expect(bases).toEqual([...SSBJ_SCOPE2_BASES]);
  });

  it('Scope 3 はカテゴリ、Scope 2 は基準が必須（NULL を通さないよう is not null を明示する）', () => {
    expect(external).toContain('(scope = 3 and "scope3CategoryId" is not null and "scope3CategoryId" between 1 and 15) or (scope <> 3 and "scope3CategoryId" is null)');
    expect(external).toContain('(scope = 2 and "scope2Basis" is not null and "scope2Basis" in (\'location\', \'market\')) or (scope <> 2 and "scope2Basis" is null)');
  });

  it('出典（算定した者・方法・根拠文書）と確認者・確認日時は必須', () => {
    for (const column of ['"calculatedBy" text not null', '"calculationMethod" text not null', '"evidenceId" uuid not null',
      '"confirmedByUserId" uuid not null', '"confirmedAt" timestamptz not null', 'value numeric not null']) {
      expect(external).toContain(column);
    }
    expect(external).toContain('check (btrim("calculatedBy") <> \'\')');
    expect(external).toContain('check (btrim("calculationMethod") <> \'\')');
    expect(external).toContain('check (value >= 0)');
  });

  it('根拠文書の参照は、版の復元の途中で止めないよう、トランザクションの最後に確かめる', () => {
    expect(external).toContain('"evidenceId" uuid not null references ssbj_evidence(id) deferrable initially deferred');
  });
});

describe('二重計上の防止', () => {
  it('SQLSTATE は services と同じ', () => {
    expect(SSBJ_EXTERNAL_EMISSION_SQLSTATE.overlapsOgt).toBe('P2071');
    expect(SSBJ_EXTERNAL_EMISSION_SQLSTATE.overlapsExternal).toBe('P2072');
    expect(SSBJ_OGT_ADOPTION_SQLSTATE.overlapsExternal).toBe('P2071');
    expect(external).toContain("using errcode = 'P2071'");
    expect(external).toContain("using errcode = 'P2072'");
  });

  it('OGT の採用値と重なるのは、Scope 2 以外で、CO2 を含み、同じ Scope・カテゴリの OGT の値が算定済みのとき', () => {
    expect(external).toContain("when p_scope <> 2 and 'CO2' = any (p_gases) and exists (");
    expect(external).toContain("and (v.value ->> 'scope')::smallint = p_scope and (v.value ->> 'scope3CategoryId')::smallint is not distinct from p_category and v.value -> 'value' ->> 'state' = 'answered'");
  });

  it('外部算定値どうしが重なるのは、同じ Scope・カテゴリ・基準で、対象ガスが重なるとき', () => {
    expect(external).toContain('and e.scope = p_scope and e."scope3CategoryId" is not distinct from p_category and e."scope2Basis" is not distinct from p_basis and e.gases && p_gases');
  });

  it('外部算定値と OGT の採用値の両方の書き込みで、トランザクションの最後に確かめる', () => {
    expect(external).toContain('create constraint trigger check_ssbj_external_emissions_overlap after insert or update on ssbj_external_emissions deferrable initially deferred');
    expect(external).toContain('create constraint trigger check_ssbj_ogt_adoptions_overlap after insert or update on ssbj_ogt_adoptions deferrable initially deferred');
  });
});

describe('Scope 2 の二重計上の防止（R2-23）', () => {
  it('Scope 2 は、CO2 を含み、同じ基準の OGT の合計が算定済みのとき OGT と重なる', () => {
    expect(scope2Overlap).toContain("when p_scope = 2 and 'CO2' = any (p_gases) and exists (");
    expect(scope2Overlap).toContain(
      "and v.value -> 'method' -> 'basisTotals' -> (case p_basis when 'location' then 'locationBased' when 'market' then 'marketBased' end) ->> 'state' = 'answered'",
    );
  });

  it('Scope 1・Scope 3 と、外部算定値どうしの判定は 20261023110000 と同じ', () => {
    expect(scope2Overlap).toContain("when p_scope <> 2 and 'CO2' = any (p_gases) and exists (");
    expect(scope2Overlap).toContain("and (v.value ->> 'scope')::smallint = p_scope and (v.value ->> 'scope3CategoryId')::smallint is not distinct from p_category and v.value -> 'value' ->> 'state' = 'answered'");
    expect(scope2Overlap).toContain('and e.scope = p_scope and e."scope3CategoryId" is not distinct from p_category and e."scope2Basis" is not distinct from p_basis and e.gases && p_gases');
    expect(scope2Overlap).toContain("using errcode = 'P2071'");
    expect(scope2Overlap).toContain("using errcode = 'P2072'");
  });

  it('置き換えた判定の関数は service_role 限定のまま', () => {
    const fn = 'ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[])';
    expect(scope2Overlap).toContain(`revoke execute on function ${fn} from public, anon, authenticated;`);
    expect(scope2Overlap).toContain(`grant execute on function ${fn} to service_role;`);
    expect(scope2Overlap).toContain("security definer set search_path = ''");
  });
});

describe('RLS と権限', () => {
  it('根拠文書は同じレポートのもの、確認者は同じ組織の利用者に限る', () => {
    for (const command of ['insert', 'update']) {
      const start = external.indexOf(`create policy "ssbj_external_emissions_${command}_own_organization"`);
      const policy = external.slice(start, external.indexOf(';', start));
      expect(policy).toContain('where ev.id = "evidenceId" and ev."reportId" = ssbj_external_emissions."reportId"');
      expect(policy).toContain('where p.id = "confirmedByUserId" and p."organizationId" = (select current_user_organization_id())');
    }
  });

  it('判定の関数・保存版と復元の関数は service_role 限定', () => {
    for (const fn of [
      'ssbj_external_emission_overlap(uuid, uuid, smallint, smallint, text, varchar[])',
      'ssbj_snapshot_section__external_emissions(uuid)',
      'ssbj_restore_section__external_emissions(uuid, uuid, uuid, jsonb)',
    ]) {
      expect(external).toContain(`revoke execute on function ${fn} from public, anon, authenticated;`);
      expect(external).toContain(`grant execute on function ${fn} to service_role;`);
    }
  });

  it('保存版には、その時点の資料名と確認者の名前も残す', () => {
    expect(external).toContain("'evidenceTitle', ev.\"documentTitle\"");
    expect(external).toContain("'confirmedByName', coalesce(p.\"fullName\", p.email)");
    expect(external).toContain("'value', e.value::text");
  });
});
