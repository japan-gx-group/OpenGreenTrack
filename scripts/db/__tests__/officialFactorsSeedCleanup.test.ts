// 公式係数 seed 末尾の「翌年度コピー行の後始末」delete に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルは scripts/official-factors/generate.ts だが、検証対象は生成物の SQL 文面
// そのものなので、DB スクリプトと同じ scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// 参照の有無を行単位で判定すると、明示指定・算定済みで参照が付いた事業者別の行だけが残る
// 「部分削除」状態になる。残存行があるため resolveEmissionFactor の officialYearIndex は
// その energyType のその年度を「公表済み」と数えて暫定適用を止める一方、自動解決の唯一の受け皿である
// 代替値行（providerName なし）は参照が無いので消えており、事業者別係数は自動解決の対象外なので
// 候補が 1 件も無く未算定になる。公式係数は organizationId is null の全組織共有のため、
// 1 組織の明示指定が全組織の未算定を招く。
// そのため参照判定は energyType + applicableYear の単位で行い、参照が 1 件でも残るグループは
// コピー行を全部残す。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const seedSql = readFileSync(
  path.join(process.cwd(), 'supabase/seeds/production/official_emission_factors.sql'),
  'utf8',
);

/** seed 末尾の delete 文（1 文だけであることも確認する） */
const cleanupStatement = (): string => {
  const statements = seedSql.match(/delete from emission_factors[\s\S]*?;/g) ?? [];
  expect(statements).toHaveLength(1);
  const [statement] = statements;
  // 上の toHaveLength(1) で 1 文あることは保証されるが、型の上では undefined が残るため明示的に潰す。
  if (statement === undefined) {
    throw new Error('seed 末尾の delete 文が見つかりません');
  }
  return statement;
};

describe('公式係数 seed の翌年度コピー行 cleanup', () => {
  it('全組織共有（organizationId is null）の、収録年度より後の行だけを対象にする', () => {
    const statement = cleanupStatement();
    expect(statement).toMatch(/ef\."organizationId" is null/);
    expect(statement).toMatch(/ef\."applicableYear" > \d{4}/);
  });

  it('参照の有無を energyType + applicableYear 単位で見る（行単位で判定しない）', () => {
    const statement = cleanupStatement();

    // 参照判定は emission_factors の相関サブクエリで energyType と applicableYear を揃えて行う
    expect(statement).toMatch(/not exists \(\s*select 1\s*from emission_factors ref/);
    expect(statement).toMatch(/ref\."energyType" = ef\."energyType"/);
    expect(statement).toMatch(/ref\."applicableYear" = ef\."applicableYear"/);
    expect(statement).toMatch(/ref\."organizationId" is null/);

    // 行単位の判定（削除対象の行 ef.id を直接参照元と突き合わせる）に戻っていないこと
    expect(statement).not.toMatch(/"emissionFactorId" = ef\.id/);
  });

  it('算定結果・活動量のどちらからの参照でもグループを残す', () => {
    const statement = cleanupStatement();
    expect(statement).toMatch(
      /exists \(select 1 from emission_results er where er\."emissionFactorId" = ref\.id\)\s*or\s*exists \(select 1 from activity_records ar where ar\."emissionFactorId" = ref\.id\)/,
    );
  });
});
