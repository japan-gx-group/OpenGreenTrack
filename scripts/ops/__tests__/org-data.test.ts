// scripts/ops/org-data.ts の単体テスト（組織のデータの件数の確認・書き出し・削除のスクリプト）。
//
// 純粋関数（引数の解釈・SQL の組み立て・psql の出力の読み取り・書き出すファイル）だけを対象にし、
// docker / psql / DB には触れない。実際の DB での動き（書き出しの件数・削除が組織の範囲を越えないこと・
// ほかの組織の行が変わると止まること）は、ローカル Supabase での演習で確かめ、手順書に記録している。

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDeleteSql,
  buildExportFiles,
  buildExportSql,
  buildSummarySql,
  exportRowExpression,
  isInsideDirectory,
  MARKER,
  organizationFilter,
  outsideRepositoryError,
  parseArgs,
  parseDeleteOutput,
  parseExportOutput,
  parseSummaryOutput,
  UsageError,
} from '../org-data.ts';
import { ORG_DATA_TABLES } from '../orgDataTables.ts';

const ORG = '11111111-1111-1111-1111-111111111111';

describe('CLI エントリガード', () => {
  it('テストから import しただけでは CLI（main）が走らない', () => {
    expect(process.exitCode).toBeUndefined();
  });
});

describe('parseArgs', () => {
  const options = (argv: string[]) => {
    const parsed = parseArgs(argv);
    if (parsed.help) throw new Error('help');
    return parsed.options;
  };

  it('サブコマンドと組織 ID を読み、既定はローカル Supabase・削除は試行にする', () => {
    expect(options(['summary', '--org', ORG])).toMatchObject({
      command: 'summary', organizationId: ORG, dbUrl: null, container: null, execute: false,
    });
    expect(options(['delete', `--org=${ORG}`])).toMatchObject({ command: 'delete', execute: false });
    expect(parseArgs(['--help'])).toEqual({ help: true });
  });

  it('組織 ID は小文字の UUID に限る（SQL に値として埋め込むため）', () => {
    expect(() => parseArgs(['summary'])).toThrow(UsageError);
    expect(() => parseArgs(['summary', '--org', 'AAAAAAAA-0000-0000-0000-000000000001'])).toThrow('UUID');
    expect(() => parseArgs(['summary', '--org', `${ORG}' or '1'='1`])).toThrow('UUID');
  });

  it('実際の削除には、組織名の確認と記録の保存先をそろえる', () => {
    expect(() => parseArgs(['delete', '--org', ORG, '--execute'])).toThrow('--confirm-name');
    expect(() => parseArgs(['delete', '--org', ORG, '--execute', '--confirm-name', 'A'])).toThrow('--record');
    expect(() => parseArgs(['delete', '--org', ORG, '--confirm-name', 'A', '--record', '/tmp/r.json'])).toThrow('--execute');
    expect(options(['delete', '--org', ORG, '--execute', '--confirm-name', '架空精密工業株式会社', '--record', '/tmp/r.json']))
      .toMatchObject({ execute: true, confirmName: '架空精密工業株式会社', record: '/tmp/r.json' });
  });

  it('サブコマンドに関係しないオプションや、矛盾する指定は誤りにする', () => {
    expect(() => parseArgs(['export', '--org', ORG])).toThrow('--out');
    expect(() => parseArgs(['summary', '--org', ORG, '--execute'])).toThrow('summary では使えません');
    expect(() => parseArgs(['export', '--org', ORG, '--out', '/tmp/x', '--json'])).toThrow('export では使えません');
    expect(() => parseArgs(['summary', '--org', ORG, '--db-url', 'postgresql://x', '--container', 'c'])).toThrow('同時に');
    expect(() => parseArgs(['summary', 'export', '--org', ORG])).toThrow('1 つだけ');
    expect(() => parseArgs(['summary', '--org', ORG, '--org', ORG])).toThrow('1 回だけ');
    expect(() => parseArgs(['purge', '--org', ORG])).toThrow('summary・export・delete');
    expect(() => parseArgs(['summary', '--org', ORG, '--delete-audit-logs'])).toThrow('summary では使えません');
  });

  it('監査ログを消すのは --delete-audit-logs を明示したときだけ', () => {
    expect(options(['delete', '--org', ORG])).toMatchObject({ deleteAuditLogs: false });
    expect(options(['delete', '--org', ORG, '--delete-audit-logs'])).toMatchObject({ deleteAuditLogs: true });
  });

  it('接続文字列は環境変数 OGT_DB_URL からも受け取れる（引数は ps で見えるため）', () => {
    const fromEnv = parseArgs(['summary', '--org', ORG, '--db-url-from-env'], { OGT_DB_URL: 'postgresql://example' });
    expect(fromEnv.help ? null : fromEnv.options.dbUrl).toBe('postgresql://example');
    expect(() => parseArgs(['summary', '--org', ORG, '--db-url-from-env'], {})).toThrow('OGT_DB_URL');
    expect(() => parseArgs(['summary', '--org', ORG, '--db-url-from-env', '--db-url', 'postgresql://x'], { OGT_DB_URL: 'y' }))
      .toThrow('同時に');
    expect(() => parseArgs(['summary', '--org', ORG, '--db-url-from-env', '--container', 'c'], { OGT_DB_URL: 'y' }))
      .toThrow('同時に');
    // 指定しなければ、環境変数があっても使わない（ローカルのつもりでクラウドに繋がないため）。
    expect(options(['summary', '--org', ORG])).toMatchObject({ dbUrl: null });
  });
});

describe('SQL の組み立て', () => {
  it('どのテーブルも、この組織の行だけを選ぶ', () => {
    expect(organizationFilter(ORG_DATA_TABLES[0], ORG)).toBe(`t."id" = '${ORG}'::uuid`);
    const summary = buildSummarySql(ORG);
    const exported = buildExportSql(ORG);
    for (const table of ORG_DATA_TABLES) {
      const filter = organizationFilter(table, ORG);
      expect(summary).toContain(`from public."${table.name}" t where ${filter}`);
      expect(exported).toContain(`from public."${table.name}" t where ${filter} order by`);
    }
    expect(() => organizationFilter(ORG_DATA_TABLES[0], 'x')).toThrow();
  });

  it('書き出しは読むだけの 1 つのトランザクションで、認証に使う列を除く', () => {
    const exported = buildExportSql(ORG);
    expect(exported).toContain('begin isolation level repeatable read read only;');
    expect(exported).not.toMatch(/\b(delete|update|insert)\b/i);
    expect(exportRowExpression(ORG_DATA_TABLES.find(table => table.name === 'organizations')!))
      .toBe("(to_jsonb(t) - array['apiKeyHash']::text[])::text");
    expect(exportRowExpression(ORG_DATA_TABLES.find(table => table.name === 'invites')!)).toContain("'token'");
    expect(exportRowExpression(ORG_DATA_TABLES.find(table => table.name === 'locations')!)).toBe('to_jsonb(t)::text');
  });

  it('削除は試行なら元に戻し、実行なら確かめてから確定する', () => {
    const dryRun = buildDeleteSql(ORG, false);
    const execute = buildDeleteSql(ORG, true);
    expect(dryRun.trimEnd().endsWith('rollback;')).toBe(true);
    expect(dryRun).not.toContain('commit;');
    expect(execute.trimEnd().endsWith('commit;')).toBe(true);
    for (const sql of [dryRun, execute]) {
      expect(sql).toContain('begin isolation level repeatable read;');
      // 確定・取り消しの前に、残った行とほかの組織の行を確かめる。
      expect(sql.indexOf('削除の後も、この組織の行が残っています')).toBeLessThan(sql.lastIndexOf('\\echo'));
      expect(sql).toContain('ほかの組織の行が変わりました');
    }
  });

  it('監査ログ（system_audit_logs）は、明示したときだけ消す。既定では、監査ログがあれば何も消さずに止める（Issue #160）', () => {
    const keep = buildDeleteSql(ORG, true);
    expect(keep).not.toContain('delete from public.system_audit_logs');
    expect(keep).toContain('Issue #160');
    // 止める確認は、何かを消す前に行う。
    expect(keep.indexOf('Issue #160')).toBeLessThan(keep.indexOf('delete from'));
    expect(buildDeleteSql(ORG, true, true)).toContain(`delete from public.system_audit_logs where "organizationId" = '${ORG}'::uuid;`);
    expect(buildDeleteSql(ORG, true, true)).not.toContain('Issue #160');
  });

  it('削除の文は 3 つだけで、どれもこの組織に絞る（ほかの行は外部キーの連鎖削除に任せる）', () => {
    const deletes = buildDeleteSql(ORG, true, true).match(/delete from [^;]+;/g) ?? [];
    expect(deletes).toEqual([
      `delete from public.system_audit_logs where "organizationId" = '${ORG}'::uuid;`,
      `delete from auth.users u where u.id in (select p.id from public.profiles p where p."organizationId" = '${ORG}'::uuid);`,
      `delete from public.organizations where id = '${ORG}'::uuid;`,
    ]);
  });

  it('削除の前後で、すべてのテーブルの件数とほかの組織のチェックサムを取る', () => {
    const sql = buildDeleteSql(ORG, false);
    for (const temp of ['ogt_org_data_before', 'ogt_org_data_after']) {
      const snapshot = sql.slice(sql.indexOf(`create temp table ${temp}`));
      for (const table of ORG_DATA_TABLES) expect(snapshot).toContain(`from public."${table.name}" t`);
      expect(snapshot).toContain("select 'auth.users'");
    }
  });

  it('Storage にファイルが残っていれば、何も消さずに止める（Storage が無い DB でも動く）', () => {
    const sql = buildDeleteSql(ORG, true);
    expect(sql).toContain("select to_regclass('storage.objects') is not null as has_storage \\gset");
    expect(sql.indexOf('Storage にこの組織のファイルが残っています')).toBeLessThan(sql.indexOf('delete from'));
  });
});

describe('psql の出力の読み取り', () => {
  const exportOutput = (override: Partial<Record<string, string[]>> = {}) => {
    const lines = [`${MARKER} organization`, '架空精密工業株式会社'];
    for (const table of ORG_DATA_TABLES) {
      const rows = override[table.name] ?? (table.name === 'locations' ? ['{"id": "a"}', '{"id": "b"}'] : []);
      const count = table.name === 'locations' ? '2' : String(rows.length);
      lines.push(`${MARKER} table ${table.name}`, ...rows, `${MARKER} count ${table.name}`, count);
    }
    lines.push(`${MARKER} count auth.users`, '3', `${MARKER} end`);
    return lines.join('\n');
  };

  it('書き出した行数と DB 上の件数を照らし合わせる', () => {
    const parsed = parseExportOutput(exportOutput());
    expect(parsed.organizationName).toBe('架空精密工業株式会社');
    expect(parsed.tables.find(table => table.name === 'locations')).toMatchObject({ databaseRows: 2, lines: ['{"id": "a"}', '{"id": "b"}'] });
    expect(parsed.authUsers).toBe(3);
    expect(() => parseExportOutput(exportOutput({ locations: ['{"id": "a"}'] }))).toThrow('一致しません');
  });

  it('途中で終わった出力や、テーブルの漏れは誤りにする', () => {
    expect(() => parseExportOutput(exportOutput().replace(`${MARKER} end`, ''))).toThrow('途中で終わって');
    const withoutLocations = exportOutput()
      .replace(`${MARKER} table locations\n{"id": "a"}\n{"id": "b"}\n${MARKER} count locations\n2\n`, '');
    expect(() => parseExportOutput(withoutLocations)).toThrow('書き出されていないテーブル');
  });

  it('summary と delete の結果を読む', () => {
    const summary = parseSummaryOutput([`${MARKER} organization`, '組織', `${MARKER} summary`, 'locations|13|abc', 'auth.users|3|', `${MARKER} end`].join('\n'));
    expect(summary).toEqual({ organizationName: '組織', rows: [{ name: 'locations', rows: 13, checksum: 'abc' }, { name: 'auth.users', rows: 3, checksum: '' }] });
    const deleted = parseDeleteOutput([`${MARKER} organization`, '組織', `${MARKER} result`, 'locations|13|5', `${MARKER} end`].join('\n'));
    expect(deleted.rows).toEqual([{ name: 'locations', targetRows: 13, otherRows: 5 }]);
    expect(() => parseSummaryOutput([`${MARKER} organization`, '組織', `${MARKER} summary`, 'locations|x|', `${MARKER} end`].join('\n'))).toThrow('件数');
  });
});

describe('書き出すファイル', () => {
  it('テーブルごとの JSON Lines と、件数・sha256・書き出さない列を書いた manifest を作る', () => {
    const parsed = parseExportOutput([
      `${MARKER} organization`, '組織',
      ...ORG_DATA_TABLES.flatMap(table => [
        `${MARKER} table ${table.name}`, ...(table.name === 'locations' ? ['{"id": "a"}'] : []),
        `${MARKER} count ${table.name}`, table.name === 'locations' ? '1' : '0',
      ]),
      `${MARKER} count auth.users`, '0', `${MARKER} end`,
    ].join('\n'));
    const { files, manifest } = buildExportFiles(parsed, ORG, '2026-10-11T00:00:00.000Z', 'ローカル');
    expect(files.get('locations.jsonl')).toBe('{"id": "a"}\n');
    expect(files.get('fiscal_years.jsonl')).toBe('');
    expect(manifest.tables.find(table => table.name === 'locations')).toMatchObject({ rows: 1, file: 'locations.jsonl' });
    expect(manifest.tables.find(table => table.name === 'organizations')?.omittedColumns).toEqual(['apiKeyHash']);
    expect(manifest.tables.find(table => table.name === 'locations')?.sha256)
      .toBe(createHash('sha256').update('{"id": "a"}\n').digest('hex'));
    expect(JSON.parse(files.get('manifest.json')!)).toEqual(manifest);
  });
});

describe('置き場所', () => {
  let dir: string | null = null;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

  it('リポジトリの中には組織のデータを置かせない', () => {
    const repo = path.resolve(process.cwd());
    expect(outsideRepositoryError(path.join(repo, 'export'), repo)).toContain('リポジトリの中');
    expect(outsideRepositoryError(path.join(repo, 'scripts', 'ops', 'x.json'), repo)).toContain('リポジトリの中');
    dir = mkdtempSync(path.join(tmpdir(), 'org-data-'));
    expect(outsideRepositoryError(path.join(dir, 'export'), repo)).toBeNull();
    expect(isInsideDirectory('/a/b', '/a/b')).toBe(true);
    expect(isInsideDirectory('/a/b', '/a/bc')).toBe(false);
    expect(isInsideDirectory('/a/b', '/a')).toBe(false);
  });
});
