// activity_records が参照する係数の組織帰属チェックに対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので、
// feature 側ではなく DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 検証対象:
//   20260831000001_rls.sql の activity_records insert / update ポリシー —
//   "locationId" だけでなく "emissionFactorId" / "ideaFactorId" の組織帰属も
//   with check で検証すること。参照する側の組織帰属は FK では担保できない
//   （FK は行の存在しか見ない）ため、検証を落とすと PostgREST を直接叩くだけで
//   他組織のカスタム係数や他組織の idea_factors を参照する自組織レコードを作れてしまい、
//   「PostgREST を直接叩いても他組織へ到達できない」（同ファイル冒頭）という
//   設計原則から外れる。idea_factors は IDEA のライセンスが法人単位で
//   契約組織の外へ出せない境界のため、参照だけでも組織をまたがせない。
//   公式係数（emission_factors の "organizationId" is null）は全組織共通マスタなので
//   参照を許し続ける必要がある（塞ぎすぎると Scope1/2 の通常入力が保存できなくなる）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rlsSql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260831000001_rls.sql'),
  'utf8',
);

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const normalize = (sql: string): string =>
  sql
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ');

const normalizedRls = normalize(rlsSql);

/** `create policy "<name>" …` から、次の create policy の手前までを切り出す */
const policyBody = (name: string): string => {
  const start = normalizedRls.indexOf(`create policy "${name}"`);
  expect(start).toBeGreaterThan(-1);
  const rest = normalizedRls.slice(start + 1);
  const end = rest.indexOf('create policy ');
  return end === -1 ? normalizedRls.slice(start) : normalizedRls.slice(start, start + 1 + end);
};

const POLICIES = [
  'activity_records_insert_own_organization',
  'activity_records_update_own_organization',
] as const;

describe.each(POLICIES)('%s', policyName => {
  const body = policyBody(policyName);

  it('"locationId" の自組織帰属を検証する', () => {
    expect(body).toContain(
      'exists ( select 1 from locations l where l.id = "locationId" and l."organizationId" = (select current_user_organization_id()) )',
    );
  });

  it('"ideaFactorId" は自組織の idea_factors だけ参照できる', () => {
    expect(body).toContain(
      '"ideaFactorId" is null or exists ( select 1 from idea_factors f where f.id = "ideaFactorId" and f."organizationId" = (select current_user_organization_id()) )',
    );
  });

  it('"emissionFactorId" は自組織のカスタム係数と公式係数だけ参照できる', () => {
    expect(body).toContain(
      '"emissionFactorId" is null or exists ( select 1 from emission_factors ef where ef.id = "emissionFactorId" and ( ef."organizationId" is null or ef."organizationId" = (select current_user_organization_id()) ) )',
    );
  });

  it('組織自体の一致（"organizationId"）を with check に残している', () => {
    const withCheck = body.slice(body.indexOf('with check'));
    expect(withCheck).toContain('"organizationId" = (select current_user_organization_id())');
  });
});

describe('activity_records の他ポリシー', () => {
  it.each(['select', 'delete'] as const)(
    '%s は組織一致のみ（読み取り・削除の範囲は係数参照で狭めない）',
    operation => {
      // 係数側の exists をここに足すと、他組織の係数を参照してしまった既存行や
      // 参照切れの行が読めず・消せなくなる。
      const body = policyBody(`activity_records_${operation}_own_organization`);
      expect(body).toContain('"organizationId" = (select current_user_organization_id())');
      expect(body).not.toContain('emission_factors');
      expect(body).not.toContain('idea_factors');
    },
  );
});
