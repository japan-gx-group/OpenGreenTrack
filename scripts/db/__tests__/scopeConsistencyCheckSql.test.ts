// 管理者向け確認 SQL（docs/calculation-logic.md §4「既存データの整合確認」）に対する回帰テスト。
//
// 対応する実装ファイルが無く、検証対象はドキュメント中の SQL 文面そのものなので
// scripts/db/__tests__/ に置いている（AGENTS.md R13）。
//
// この SQL は種別ごとの Scope（src/features/calculation/engine/energyTypeScope.ts）を
// case when で書き写している。DB 側では同じ判定を書く手段が他に無いが、写しが古いままだと
// 「不整合は 0 件」と誤報告する。EnergyType に種別を足したときに気づけるよう、
// SQL から読み取った対応と SCOPE_BY_ENERGY_TYPE の一致をここで検証する。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCOPE_BY_ENERGY_TYPE } from '../../../src/features/calculation/engine/energyTypeScope';
import type { Scope } from '../../../src/features/calculation/types';

const doc = readFileSync(path.join(process.cwd(), 'docs/calculation-logic.md'), 'utf8');

/** §4「既存データの整合確認」の SQL ブロック */
const checkSql = (): string => {
  const section = doc.slice(doc.indexOf('### 既存データの整合確認'));
  const blocks = section.slice(0, section.indexOf('### 方式別集計')).match(/```sql\n([\s\S]*?)```/);
  expect(blocks).not.toBeNull();
  return blocks![1];
};

/** case when 1 つぶんの「種別の集合 → Scope」。else 句は列挙の残り全部を受ける。 */
type ScopeBranches = { listed: Map<Scope, Set<string>>; fallback: Scope };

/**
 * `case when "energyType" in (…) then 'scopeN' … else 'scopeN' end` を読み取る。
 * SQL は 2 本あり、どちらも同じ対応を書いているため 1 本ずつ検証する。
 */
const parseScopeBranches = (sql: string): ScopeBranches[] =>
  [...sql.matchAll(/select case\n([\s\S]*?)\n\s*end as expected_scope/g)].map(([, body]) => {
    const listed = new Map<Scope, Set<string>>();
    for (const [, list, scope] of body.matchAll(/in \(([\s\S]*?)\) then '(scope[123])'/g)) {
      listed.set(
        scope as Scope,
        new Set([...list.matchAll(/'([a-z_0-9]+)'/g)].map(([, energyType]) => energyType)),
      );
    }
    const fallback = body.match(/else '(scope[123])'/)?.[1] as Scope | undefined;
    expect(fallback).toBeDefined();
    return { listed, fallback: fallback! };
  });

const expectedTypesFor = (scope: Scope): Set<string> =>
  new Set(Object.entries(SCOPE_BY_ENERGY_TYPE).filter(([, s]) => s === scope).map(([type]) => type));

describe('既存データの整合確認 SQL（docs/calculation-logic.md §4）', () => {
  const branchSets = parseScopeBranches(checkSql());

  it('係数と算定結果の 2 本とも case when で Scope を導出している', () => {
    expect(branchSets).toHaveLength(2);
  });

  it('SQL の case when が SCOPE_BY_ENERGY_TYPE と一致する', () => {
    for (const { listed, fallback } of branchSets) {
      for (const [scope, types] of listed) {
        expect([...types].sort()).toEqual([...expectedTypesFor(scope)].sort());
      }
      // else 句は列挙されなかった残り全部を受けるので、その Scope の全種別と一致する必要がある
      const listedTypes = new Set([...listed.values()].flatMap(types => [...types]));
      const remaining = Object.keys(SCOPE_BY_ENERGY_TYPE).filter(type => !listedTypes.has(type));
      expect(remaining.sort()).toEqual([...expectedTypesFor(fallback)].sort());
    }
  });
});
