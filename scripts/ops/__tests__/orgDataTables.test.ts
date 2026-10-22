// 組織のデータの一覧（scripts/ops/orgDataTables.ts）に、テーブルの漏れが無いことを確かめる（実DBを使わない机上検証）。
//
// テーブルを足した人が一覧に足し忘れると、組織のデータを返すときに書き出されず、削除の確認からも漏れる。
// supabase/migrations の create table（public スキーマ）をすべて拾い、一覧か「組織に属さないテーブル」のどちらかにあることを求める。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ORG_DATA_TABLES, SHARED_TABLES } from '../orgDataTables.ts';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文（マイグレーションの適用順につなぐ） */
const all = readdirSync(migrationsDir).sort()
  .map(name => readFileSync(path.join(migrationsDir, name), 'utf8'))
  .join('\n')
  .split(/\r?\n/)
  .filter(line => !line.trimStart().startsWith('--'))
  .join(' ')
  .replace(/\s+/g, ' ');

/** public スキーマに作られるテーブル（スキーマを付けない名前か public. 付き）。 */
const createdTables = [...all.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+) \(/g)].map(match => match[1]);

/** テーブルの列の定義（create table の本体と、後から alter table で足した列）。 */
const definitionOf = (table: string): string => {
  const create = all.match(new RegExp(`create table (?:if not exists )?(?:public\\.)?${table} \\((.*?)\\);`))?.[1] ?? '';
  const alters = [...all.matchAll(new RegExp(`alter table (?:public\\.)?${table} ([^;]*);`, 'g'))].map(match => match[1]);
  return [create, ...alters].join(' ');
};

describe('組織のデータの一覧', () => {
  it('マイグレーションで作るテーブルは、すべて一覧か「組織に属さないテーブル」にある', () => {
    const listed = new Set([...ORG_DATA_TABLES.map(table => table.name), ...Object.keys(SHARED_TABLES)]);
    const missing = createdTables.filter(table => !listed.has(table));
    // 失敗したら: 足したテーブルを scripts/ops/orgDataTables.ts の ORG_DATA_TABLES（組織に属するなら）か
    // SHARED_TABLES（全組織で共通なら。理由を書く）に足す。
    expect(missing).toEqual([]);
  });

  it('一覧のテーブルは実在し、重複しない', () => {
    const names = ORG_DATA_TABLES.map(table => table.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter(name => !createdTables.includes(name))).toEqual([]);
    expect(Object.keys(SHARED_TABLES).filter(name => names.includes(name))).toEqual([]);
  });

  it('組織を選ぶ列・主キー・書き出さない列は、そのテーブルの列にある', () => {
    for (const table of ORG_DATA_TABLES) {
      const definition = definitionOf(table.name);
      const columns = [table.organizationColumn, ...table.primaryKey, ...(table.omitColumns ?? [])];
      for (const column of columns) {
        const quoted = /[A-Z]/.test(column) ? `"${column}"` : column;
        expect(definition, `${table.name}.${column}`).toMatch(new RegExp(`(?:^|[ ,(])${quoted} `));
      }
    }
  });

  it('organizations 以外は organizationId で組織を選ぶ（組織そのものだけが id）', () => {
    expect(ORG_DATA_TABLES.filter(table => table.organizationColumn === 'id').map(table => table.name)).toEqual(['organizations']);
  });
});
