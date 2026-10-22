// scripts/db/check-migration-immutability.ts の単体テスト（AGENTS.md R9「マイグレーションの不変性」の機械チェック）。
//
// 純粋関数（parseNameStatus / findImmutabilityViolations / checkNewMigrationPath）だけを対象にし、git には触れない。

import { describe, expect, it } from 'vitest';
import {
  checkNewMigrationPath,
  findImmutabilityViolations,
  parseNameStatus,
  type NameStatusEntry,
} from '../check-migration-immutability.ts';

const existsInBase = (p: string): boolean => p.startsWith('supabase/migrations/20260831');

const reasonsOf = (entries: NameStatusEntry[]): string[] => findImmutabilityViolations(entries, { existsInBase }).map((v) => `${v.path}: ${v.reason}`);

describe('parseNameStatus', () => {
  it('-z 区切りの A / M / D を解析する', () => {
    const out = 'A\0supabase/migrations/20261101000000_x.sql\0M\0supabase/migrations/20260831000000_schema.sql\0D\0supabase/migrations/20260831000001_rls.sql\0';
    expect(parseNameStatus(out)).toEqual([
      { status: 'A', path: 'supabase/migrations/20261101000000_x.sql' },
      { status: 'M', path: 'supabase/migrations/20260831000000_schema.sql' },
      { status: 'D', path: 'supabase/migrations/20260831000001_rls.sql' },
    ]);
  });

  it('R100 のような改名は old / new の 3 要素で解析する', () => {
    const out = 'R100\0supabase/migrations/20260831000000_schema.sql\0supabase/migrations/20260831000000_schema_v2.sql\0';
    expect(parseNameStatus(out)).toEqual([
      { status: 'R', oldPath: 'supabase/migrations/20260831000000_schema.sql', path: 'supabase/migrations/20260831000000_schema_v2.sql' },
    ]);
  });

  it('空出力は空配列', () => {
    expect(parseNameStatus('')).toEqual([]);
  });
});

describe('checkNewMigrationPath', () => {
  it('正しい名前の .sql は通す', () => {
    expect(checkNewMigrationPath('supabase/migrations/20261101120000_add_column.sql')).toBeNull();
    expect(checkNewMigrationPath('./supabase/migrations/20261101120000_add_column.sql')).toBeNull();
  });

  it('不正な名前・拡張子・サブディレクトリを指摘する', () => {
    expect(checkNewMigrationPath('supabase/migrations/add_column.sql')).toMatch(/14桁/);
    expect(checkNewMigrationPath('supabase/migrations/20261101120000_AddColumn.sql')).toMatch(/14桁/);
    expect(checkNewMigrationPath('supabase/migrations/20261101120000_x.sql.bak')).toMatch(/\.sql 以外/);
    expect(checkNewMigrationPath('supabase/migrations/archive/20261101120000_x.sql')).toMatch(/直下/);
  });

  it('migrations 以外のパスには関与しない', () => {
    expect(checkNewMigrationPath('supabase/seeds/demo/demo.sql')).toBeNull();
  });
});

describe('findImmutabilityViolations', () => {
  it('基準に存在するファイルの編集・削除を違反にする', () => {
    expect(
      reasonsOf([
        { status: 'M', path: 'supabase/migrations/20260831000000_schema.sql' },
        { status: 'D', path: 'supabase/migrations/20260831000001_rls.sql' },
        { status: 'T', path: 'supabase/migrations/20260831000002_rpc.sql' },
      ]),
    ).toEqual([
      expect.stringMatching(/schema\.sql: 既存マイグレーションの編集/),
      expect.stringMatching(/rls\.sql: 既存マイグレーションの削除/),
      expect.stringMatching(/rpc\.sql: 既存マイグレーションの編集/),
    ]);
  });

  it('同じブランチで追加した（基準に無い）ファイルの編集は許す', () => {
    expect(reasonsOf([{ status: 'M', path: 'supabase/migrations/20261101000000_new.sql' }])).toEqual([]);
    expect(reasonsOf([{ status: 'D', path: 'supabase/migrations/20261101000000_new.sql' }])).toEqual([]);
  });

  it('追加はファイル名を検査する', () => {
    expect(reasonsOf([{ status: 'A', path: 'supabase/migrations/20261101000000_new.sql' }])).toEqual([]);
    expect(reasonsOf([{ status: 'A', path: 'supabase/migrations/new.sql' }])).toEqual([expect.stringMatching(/new\.sql: ファイル名は/)]);
  });

  it('既存ファイルの改名・複製を違反にし、新規ファイルの改名は名前だけ見る', () => {
    expect(
      reasonsOf([{ status: 'R', oldPath: 'supabase/migrations/20260831000000_schema.sql', path: 'supabase/migrations/20260831000000_schema_v2.sql' }]),
    ).toEqual([expect.stringMatching(/schema_v2\.sql: 既存マイグレーション .* の改名・複製/)]);
    expect(
      reasonsOf([{ status: 'R', oldPath: 'supabase/migrations/20261101000000_a.sql', path: 'supabase/migrations/20261101000000_b.sql' }]),
    ).toEqual([]);
  });

  it('migrations 以外の差分は無視する', () => {
    expect(reasonsOf([{ status: 'M', path: 'supabase/seeds/demo/demo.sql' }, { status: 'D', path: 'src/x.ts' }])).toEqual([]);
  });
});
