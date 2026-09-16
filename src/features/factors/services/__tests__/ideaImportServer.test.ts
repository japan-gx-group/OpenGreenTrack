// IDEA 取込ジョブ本体（processIdeaImport）と完了処理 RPC の回帰テスト。
//
// supabase の実DBは使わず、管理クライアントのスタブで
//   - 500行チャンク挿入・完了 RPC の呼び出し（§4.1）
//   - 失敗時の「failed + 部分挿入行の削除・旧 active 温存」（§4.1-3）
// を検証する。xlsx の読み取りはストリーミング（ideaImportReader.ts）だが、フィクスチャは
// 従来どおり exceljs で生成した Buffer を渡す。単一トランザクションが必要な完了処理そのものは SQL（RPC）にあるため、
// 「同一組織で2回連続取込が成功する」ための isActive 切替順（旧 false 化 → 新 true 化）は
// マイグレーション SQL（supabase/migrations/20260831000000_schema.sql・
// 20260831000002_rpc.sql）の文面に対する回帰テストで担保する（実DBでの結合検証は
// supabase 環境での一括検証時に実施する）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  IDEA_FACTOR_INSERT_CHUNK_SIZE,
  IDEA_IMPORT_MAX_FILE_SIZE_BYTES,
  IDEA_IMPORT_SQLSTATE,
  IDEA_IMPORT_MAX_FILE_SIZE_BYTES as MAX_BYTES,
  IDEA_IMPORT_STALE_MS,
  IDEA_UPLOAD_BUCKET,
  IDEA_UPLOAD_STALE_MS,
  IDEA_UPLOAD_URL_RATE_LIMIT,
  buildIdeaUploadPath,
  consumeIdeaUploadUrlQuota,
  chunkArray,
  downloadIdeaUploadFile,
  hasProcessingIdeaImport,
  isIdeaUploadPathForOrganization,
  processIdeaImport,
  recoverStaleIdeaImports,
  removeIdeaUploadFile,
  removeStaleIdeaUploadFiles,
  resetIdeaUploadUrlQuota,
  validateIdeaImportFile,
  validateIdeaImportFileMeta,
} from '../ideaImportServer';
import { DEFAULT_IDEA_GWP_MODEL, IDEA_NO_GWP_COLUMN_ERROR } from '../ideaImport';

const GWP_HEADER = '気候変動 IPCC 2021 GWP 100a without LULUCF';

/**
 * ダミー構造の IDEA xlsx を生成する（実データ値は含めない）。
 * blankGwpIndexes に指定した行は GWP セルを空欄にする（LCIA結果を持たない製品の再現。§4.1-4）。
 */
const buildDummyIdeaXlsx = async (
  rowCount: number,
  blankGwpIndexes: readonly number[] = [],
): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const versionSheet = workbook.addWorksheet('バージョン情報');
  versionSheet.getCell('A1').value = 'IDEA Ver.9.9 標準版';
  versionSheet.getCell('A2').value = '2099/01/23';

  const sheet = workbook.addWorksheet('LCIA結果_GWP');
  const headers = ['IDEA製品コード', 'IDEA製品名', '国', 'DB区分', '基準フロー', '単位', GWP_HEADER];
  headers.forEach((header, index) => {
    sheet.getRow(5).getCell(index + 1).value = header;
  });
  for (let index = 0; index < rowCount; index++) {
    const row = sheet.getRow(6 + index);
    row.getCell(1).value = `${String(index).padStart(9, '0')}mXXX`;
    row.getCell(2).value = `ダミー製品${index}`;
    row.getCell(3).value = index % 2 === 0 ? 'JPN' : 'GLO';
    row.getCell(4).value = 'CORE';
    row.getCell(5).value = 1;
    row.getCell(6).value = 'kg';
    if (!blankGwpIndexes.includes(index)) {
      row.getCell(7).value = 0.001 * (index + 1);
    }
  }
  // exceljs の writeBuffer は実行時に Node の Buffer を返す（型定義だけが独自 Buffer）
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
};

/** LIME3 版相当（GWP 列なし）のダミー xlsx */
const buildDummyLime3Xlsx = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const versionSheet = workbook.addWorksheet('バージョン情報');
  versionSheet.getCell('A1').value = 'IDEA Ver.9.9 標準版';
  const sheet = workbook.addWorksheet('LCIA結果_統合化');
  ['IDEA製品コード', 'IDEA製品名', '国', 'DB区分', '基準フロー', '単位', '統合化指標（ダミー）'].forEach(
    (header, index) => {
      sheet.getRow(5).getCell(index + 1).value = header;
    },
  );
  sheet.getRow(6).getCell(1).value = '000000001mXXX';
  sheet.getRow(6).getCell(2).value = 'ダミー製品A';
  sheet.getRow(6).getCell(3).value = 'JPN';
  sheet.getRow(6).getCell(6).value = 'kg';
  sheet.getRow(6).getCell(7).value = 0.5;
  // exceljs の writeBuffer は実行時に Node の Buffer を返す（型定義だけが独自 Buffer）
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
};

interface FakeCalls {
  updates: { table: string; values: Record<string, unknown>; match: Record<string, unknown> }[];
  inserts: { table: string; rows: Record<string, unknown>[] }[];
  deletes: { table: string; match: Record<string, unknown> }[];
  rpcs: { fn: string; args: Record<string, unknown> }[];
}

/** processIdeaImport が使う操作だけを持つ管理クライアントのスタブ */
const createFakeSupabase = (
  options: {
    insertError?: { message: string } | null;
    rpcResult?: { data: unknown; error: { code?: string; message?: string } | null };
  } = {},
) => {
  const calls: FakeCalls = { updates: [], inserts: [], deletes: [], rpcs: [] };
  const insertError = options.insertError ?? null;
  const rpcResult = options.rpcResult ?? {
    data: { rowCount: 0, unmappedRecordCount: 0 },
    error: null,
  };

  const from = (table: string) => ({
    update: (values: Record<string, unknown>) => ({
      eq: (column: string, value: unknown) => {
        calls.updates.push({ table, values, match: { [column]: value } });
        return Promise.resolve({ error: null });
      },
    }),
    insert: (rows: Record<string, unknown>[]) => {
      calls.inserts.push({ table, rows });
      return Promise.resolve({ error: insertError });
    },
    delete: () => ({
      eq: (column: string, value: unknown) => {
        calls.deletes.push({ table, match: { [column]: value } });
        return Promise.resolve({ error: null });
      },
    }),
  });
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.rpcs.push({ fn, args });
    return Promise.resolve(rpcResult);
  };

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    calls,
  };
};

describe('processIdeaImport', () => {
  let dummyXlsx: Buffer;

  beforeAll(async () => {
    // 500行チャンクの分割を検証できる行数（500 + 500 + 200）
    dummyXlsx = await buildDummyIdeaXlsx(1200);
  });

  it('正常系: メタ更新 → 500行チャンク挿入 → 完了RPC の順で処理する', async () => {
    const { client, calls } = createFakeSupabase({
      rpcResult: { data: { rowCount: 1200, unmappedRecordCount: 2 }, error: null },
    });

    const result = await processIdeaImport({
      importId: 'import-1',
      organizationId: 'org-1',
      fileBuffer: dummyXlsx,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      supabase: client,
    });

    expect(result.status).toBe('completed');
    expect(result.rowCount).toBe(1200);
    expect(result.unmappedRecordCount).toBe(2);

    // メタ情報（バージョン・引用表記・実際の列識別子）の反映
    const metaUpdate = calls.updates.find((update) => update.table === 'idea_imports');
    expect(metaUpdate?.values).toMatchObject({
      version: 'Ver.9.9 標準版',
      releaseDate: '2099-01-23',
      gwpModel: GWP_HEADER,
      skippedRowCount: 0,
    });
    // TS 側では isActive に決して触れない（切替は RPC 内の単一トランザクションのみ。§4.1-3）
    for (const update of calls.updates) {
      expect(update.values).not.toHaveProperty('isActive');
    }

    // 500行チャンク挿入
    const factorInserts = calls.inserts.filter((insert) => insert.table === 'idea_factors');
    expect(factorInserts.map((insert) => insert.rows.length)).toEqual([500, 500, 200]);
    expect(factorInserts[0].rows.length).toBe(IDEA_FACTOR_INSERT_CHUNK_SIZE);
    expect(factorInserts[0].rows[0]).toMatchObject({
      organizationId: 'org-1',
      importId: 'import-1',
      ideaCode: '000000000mXXX',
      unit: 'kg',
    });

    // 完了処理は RPC（単一トランザクション）へ委譲
    expect(calls.rpcs).toEqual([
      {
        fn: 'complete_idea_import',
        args: { p_import_id: 'import-1', p_organization_id: 'org-1' },
      },
    ]);
    expect(calls.deletes).toEqual([]);
  });

  it('GWP空欄行がある場合: 取込は成功し、対象外にした件数を skippedRowCount に記録する（§4.1-4）', async () => {
    // IPCC 版実ファイルにおける「LCIA結果を持たない製品」（水資源のバランス調整用プロセス等）の再現
    const xlsxWithBlanks = await buildDummyIdeaXlsx(10, [2, 5, 9]);
    const { client, calls } = createFakeSupabase({
      rpcResult: { data: { rowCount: 7, unmappedRecordCount: 0 }, error: null },
    });

    const result = await processIdeaImport({
      importId: 'import-1',
      organizationId: 'org-1',
      fileBuffer: xlsxWithBlanks,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      supabase: client,
    });

    expect(result.status).toBe('completed');
    expect(result.skippedRowCount).toBe(3);
    expect(result.rowCount).toBe(7);

    const metaUpdate = calls.updates.find((update) => update.table === 'idea_imports');
    expect(metaUpdate?.values).toMatchObject({ skippedRowCount: 3 });

    // 空欄行は idea_factors へ入れない（GWP が無い製品は Scope3 の原単位として使えない）
    const insertedCodes = calls.inserts
      .filter((insert) => insert.table === 'idea_factors')
      .flatMap((insert) => insert.rows.map((row) => row.ideaCode));
    expect(insertedCodes).toHaveLength(7);
    expect(insertedCodes).not.toContain('000000002mXXX');
    expect(insertedCodes).not.toContain('000000005mXXX');
    expect(insertedCodes).not.toContain('000000009mXXX');
  });

  it('パースエラー時（LIME3版相当）: failed を記録し、挿入・完了RPCを呼ばない', async () => {
    const { client, calls } = createFakeSupabase();
    const lime3 = await buildDummyLime3Xlsx();

    const result = await processIdeaImport({
      importId: 'import-1',
      organizationId: 'org-1',
      fileBuffer: lime3,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      supabase: client,
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe(IDEA_NO_GWP_COLUMN_ERROR);
    expect(calls.inserts).toEqual([]);
    expect(calls.rpcs).toEqual([]);
    expect(calls.updates).toEqual([
      {
        table: 'idea_imports',
        values: { status: 'failed', errorMessage: IDEA_NO_GWP_COLUMN_ERROR },
        match: { id: 'import-1' },
      },
    ]);
  });

  it('壊れたファイルは読み込みエラーとして failed にする', async () => {
    const { client, calls } = createFakeSupabase();

    const result = await processIdeaImport({
      importId: 'import-1',
      organizationId: 'org-1',
      fileBuffer: Buffer.from('PK\x03\x04ここはxlsxではない'),
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      supabase: client,
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('Excelファイルの読み込みに失敗しました');
    expect(calls.inserts).toEqual([]);
  });

  it('挿入失敗時: 部分挿入行を削除して failed にする（旧 active には触れない。§4.1-3）', async () => {
    const { client, calls } = createFakeSupabase({ insertError: { message: 'insert failed' } });

    const result = await processIdeaImport({
      importId: 'import-2',
      organizationId: 'org-1',
      fileBuffer: dummyXlsx,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      supabase: client,
    });

    expect(result.status).toBe('failed');
    // 部分挿入行の削除は自インポート（importId）限定
    expect(calls.deletes).toEqual([
      { table: 'idea_factors', match: { importId: 'import-2' } },
    ]);
    // 完了RPCは呼ばれない = 旧 active インポートの isActive はそのまま（運用継続できる）
    expect(calls.rpcs).toEqual([]);
    const failedUpdate = calls.updates.at(-1);
    expect(failedUpdate?.values).toMatchObject({ status: 'failed' });
  });

  it('完了RPC失敗時も部分挿入行を削除して failed にする', async () => {
    const { client, calls } = createFakeSupabase({
      rpcResult: { data: null, error: { code: 'P2031', message: 'invalid' } },
    });

    const result = await processIdeaImport({
      importId: 'import-3',
      organizationId: 'org-1',
      fileBuffer: dummyXlsx,
      gwpModel: DEFAULT_IDEA_GWP_MODEL,
      supabase: client,
    });

    expect(result.status).toBe('failed');
    expect(calls.deletes).toEqual([
      { table: 'idea_factors', match: { importId: 'import-3' } },
    ]);
  });
});

describe('validateIdeaImportFile', () => {
  const xlsxMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

  it('xlsx（ZIPシグネチャ）を受け入れる', () => {
    expect(validateIdeaImportFile('IDEA_dummy.xlsx', xlsxMagic)).toEqual({ ok: true });
  });

  it('拡張子が xlsx 以外は拒否する', () => {
    const result = validateIdeaImportFile('IDEA_dummy.csv', xlsxMagic);
    expect(result.ok).toBe(false);
  });

  it('ZIPシグネチャの無いファイルは拒否する', () => {
    const result = validateIdeaImportFile('IDEA_dummy.xlsx', Buffer.from('plain text'));
    expect(result.ok).toBe(false);
  });

  it('空ファイル・サイズ超過は拒否する', () => {
    expect(validateIdeaImportFile('IDEA_dummy.xlsx', Buffer.alloc(0)).ok).toBe(false);
    expect(
      validateIdeaImportFile('IDEA_dummy.xlsx', Buffer.alloc(IDEA_IMPORT_MAX_FILE_SIZE_BYTES + 1))
        .ok,
    ).toBe(false);
  });
});

describe('validateIdeaImportFileMeta（署名付き URL 発行前の申告値チェック）', () => {
  it('xlsx かつ上限以内なら受け入れる', () => {
    expect(validateIdeaImportFileMeta('IDEA_dummy.xlsx', 1024)).toEqual({ ok: true });
    expect(validateIdeaImportFileMeta('IDEA_DUMMY.XLSX', IDEA_IMPORT_MAX_FILE_SIZE_BYTES)).toEqual({ ok: true });
  });

  it('拡張子違い・サイズ超過・空・不正な数値は拒否する', () => {
    expect(validateIdeaImportFileMeta('IDEA_dummy.xls', 1024).ok).toBe(false);
    expect(validateIdeaImportFileMeta('IDEA_dummy.xlsx', IDEA_IMPORT_MAX_FILE_SIZE_BYTES + 1).ok).toBe(false);
    expect(validateIdeaImportFileMeta('IDEA_dummy.xlsx', 0).ok).toBe(false);
    expect(validateIdeaImportFileMeta('IDEA_dummy.xlsx', Number.NaN).ok).toBe(false);
  });
});

describe('アップロード先パス（buildIdeaUploadPath / isIdeaUploadPathForOrganization）', () => {
  const orgId = '0198a0b1-1111-4aaa-8bbb-000000000001';
  const otherOrgId = '0198a0b1-2222-4aaa-8bbb-000000000002';

  it('自組織フォルダ配下の UUID ファイル名で発行し、その形だけを受け入れる', () => {
    const path = buildIdeaUploadPath(orgId);
    expect(path).toMatch(new RegExp(`^${orgId}/idea-imports/[0-9a-f-]{36}\\.xlsx$`));
    expect(isIdeaUploadPathForOrganization(path, orgId)).toBe(true);
  });

  it('他組織のパス・任意パス・トラバーサル・拡張子違いは拒否する（DoD: 他組織のパスでの取込拒否）', () => {
    const otherPath = buildIdeaUploadPath(otherOrgId);
    expect(isIdeaUploadPathForOrganization(otherPath, orgId)).toBe(false);
    expect(isIdeaUploadPathForOrganization(`${orgId}/secret.xlsx`, orgId)).toBe(false);
    expect(isIdeaUploadPathForOrganization(`${orgId}/idea-imports/../x.xlsx`, orgId)).toBe(false);
    expect(
      isIdeaUploadPathForOrganization(`${orgId}/idea-imports/0198a0b1-3333-4aaa-8bbb-000000000003.csv`, orgId),
    ).toBe(false);
    expect(isIdeaUploadPathForOrganization(buildIdeaUploadPath(orgId), 'not-a-uuid')).toBe(false);
  });
});

describe('quarantine のファイル取得・削除', () => {
  type StorageResult<T> = { data: T | null; error: { message: string; statusCode?: string } | null };
  const makeStorageStub = (
    info: StorageResult<{ size?: number }>,
    download: StorageResult<Blob>,
    removeError: { message: string } | null = null,
  ) => {
    const calls: { bucket: string; infoed: string[]; downloaded: string[]; removed: string[][] } = {
      bucket: '',
      infoed: [],
      downloaded: [],
      removed: [],
    };
    const client = {
      storage: {
        from: (bucket: string) => {
          calls.bucket = bucket;
          return {
            info: async (path: string) => {
              calls.infoed.push(path);
              return info;
            },
            download: async (path: string) => {
              calls.downloaded.push(path);
              return download;
            },
            remove: async (paths: string[]) => {
              calls.removed.push(paths);
              return { data: [], error: removeError };
            },
          };
        },
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  };
  const notFound = { message: 'Object not found', statusCode: '404' };
  const blob = new Blob([Uint8Array.from(Buffer.from('PK\x03\x04data'))]);

  it('downloadIdeaUploadFile: info でサイズを確認してから upload-quarantine から取得し、Buffer で返す', async () => {
    const { client, calls } = makeStorageStub({ data: { size: 8 }, error: null }, { data: blob, error: null });
    const result = await downloadIdeaUploadFile(client, 'org/idea-imports/x.xlsx');
    expect(calls.bucket).toBe(IDEA_UPLOAD_BUCKET);
    expect(calls.infoed).toEqual(['org/idea-imports/x.xlsx']);
    expect(calls.downloaded).toEqual(['org/idea-imports/x.xlsx']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('downloadIdeaUploadFile: 無ければ not_found（info・download のどちらで分かっても）', async () => {
    const missingAtInfo = makeStorageStub({ data: null, error: notFound }, { data: blob, error: null });
    expect(await downloadIdeaUploadFile(missingAtInfo.client, 'org/idea-imports/y.xlsx')).toEqual({ ok: false, reason: 'not_found' });
    expect(missingAtInfo.calls.downloaded).toEqual([]);

    const missingAtDownload = makeStorageStub({ data: { size: 8 }, error: null }, { data: null, error: notFound });
    expect(await downloadIdeaUploadFile(missingAtDownload.client, 'org/idea-imports/y.xlsx')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('downloadIdeaUploadFile: 上限超過はダウンロードせずに too_large（バケットの上限設定に頼らない）', async () => {
    const { client, calls } = makeStorageStub({ data: { size: MAX_BYTES + 1 }, error: null }, { data: blob, error: null });
    expect(await downloadIdeaUploadFile(client, 'org/idea-imports/big.xlsx')).toEqual({ ok: false, reason: 'too_large' });
    expect(calls.downloaded).toEqual([]);
  });

  it('downloadIdeaUploadFile: 見つからない以外の Storage エラーは error として区別する（見つからない扱いにしない）', async () => {
    const failing = makeStorageStub({ data: null, error: { message: 'upstream timeout', statusCode: '504' } }, { data: blob, error: null });
    const result = await downloadIdeaUploadFile(failing.client, 'org/idea-imports/z.xlsx');
    expect(result).toMatchObject({ ok: false, reason: 'error' });
  });

  it('removeIdeaUploadFile: 削除を呼び、失敗してもログに残すだけで throw しない', async () => {
    const log = { error: vi.fn() } as unknown as Logger;
    const ok = makeStorageStub({ data: null, error: null }, { data: null, error: null });
    await removeIdeaUploadFile(ok.client, 'org/idea-imports/x.xlsx', log);
    expect(ok.calls.removed).toEqual([['org/idea-imports/x.xlsx']]);
    expect(log.error).not.toHaveBeenCalled();

    const failing = makeStorageStub({ data: null, error: null }, { data: null, error: null }, { message: 'boom' });
    await expect(removeIdeaUploadFile(failing.client, 'org/idea-imports/x.xlsx', log)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe('進行中チェックと滞留行の回収', () => {
  const orgId = '0198a0b1-1111-4aaa-8bbb-000000000001';
  const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as Logger;

  it('hasProcessingIdeaImport: processing 行があれば true、DB エラーは throw', async () => {
    const make = (result: { data: unknown[] | null; error: { message: string } | null }) =>
      ({
        from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: async () => result }) }) }) }),
      }) as unknown as SupabaseClient;
    expect(await hasProcessingIdeaImport(make({ data: [{ id: 'x' }], error: null }), orgId)).toBe(true);
    expect(await hasProcessingIdeaImport(make({ data: [], error: null }), orgId)).toBe(false);
    await expect(hasProcessingIdeaImport(make({ data: null, error: { message: 'boom' } }), orgId)).rejects.toThrow('boom');
  });

  it('recoverStaleIdeaImports: 滞留窓を過ぎた processing 行を failed にする（失敗は warn のみ）', async () => {
    const now = Date.parse('2026-09-16T12:00:00Z');
    const updates: { values: Record<string, unknown>; filters: unknown[] }[] = [];
    const make = (error: { message: string } | null) =>
      ({
        from: () => ({
          update: (values: Record<string, unknown>) => {
            const filters: unknown[] = [];
            const builder = {
              eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return builder; },
              lt: async (column: string, value: unknown) => { filters.push(['lt', column, value]); updates.push({ values, filters }); return { error }; },
            };
            return builder;
          },
        }),
      }) as unknown as SupabaseClient;

    await recoverStaleIdeaImports(make(null), orgId, log, now);
    expect(updates[0].values).toMatchObject({ status: 'failed' });
    expect(updates[0].filters).toEqual([
      ['eq', 'organizationId', orgId],
      ['eq', 'status', 'processing'],
      ['lt', 'updatedAt', new Date(now - IDEA_IMPORT_STALE_MS).toISOString()],
    ]);

    await expect(recoverStaleIdeaImports(make({ message: 'boom' }), orgId, log, now)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it('consumeIdeaUploadUrlQuota: 組織単位で窓あたりの発行回数を縛る', () => {
    resetIdeaUploadUrlQuota();
    for (let index = 0; index < IDEA_UPLOAD_URL_RATE_LIMIT.limit; index++) {
      expect(consumeIdeaUploadUrlQuota('org-a')).toBe(true);
    }
    expect(consumeIdeaUploadUrlQuota('org-a')).toBe(false);
    // 別組織は別枠
    expect(consumeIdeaUploadUrlQuota('org-b')).toBe(true);
    resetIdeaUploadUrlQuota();
    expect(consumeIdeaUploadUrlQuota('org-a')).toBe(true);
  });
});

describe('removeStaleIdeaUploadFiles（取り残しファイルの掃除）', () => {
  const orgId = '0198a0b1-1111-4aaa-8bbb-000000000001';
  const now = Date.parse('2026-09-16T12:00:00Z');
  const iso = (ageMs: number) => new Date(now - ageMs).toISOString();

  const makeStub = (
    listResult: { data: Record<string, unknown>[] | null; error: { message: string } | null },
    removeError: { message: string } | null = null,
    /** 指定時は offset ごとのページを返す（ページングの検証用） */
    pages?: Record<string, unknown>[][],
  ) => {
    const calls: { listed: { folder: string; options: unknown }[]; removed: string[][] } = { listed: [], removed: [] };
    const client = {
      storage: {
        from: () => ({
          list: async (folder: string, options: { limit: number; offset: number }) => {
            calls.listed.push({ folder, options });
            if (pages) return { data: pages[options.offset / options.limit] ?? [], error: null };
            return listResult;
          },
          remove: async (paths: string[]) => {
            calls.removed.push(paths);
            return { data: [], error: removeError };
          },
        }),
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

  it('自組織フォルダ内の、閾値を過ぎたファイルだけを削除する（フォルダ要素・新しいファイルは残す）', async () => {
    const { client, calls } = makeStub({
      data: [
        { name: 'old.xlsx', id: 'id-1', created_at: iso(IDEA_UPLOAD_STALE_MS + 1000) },
        { name: 'fresh.xlsx', id: 'id-2', created_at: iso(60 * 1000) },
        { name: 'subfolder', id: null, created_at: null },
        { name: 'unknown-age.xlsx', id: 'id-3', created_at: null },
      ],
      error: null,
    });

    const removed = await removeStaleIdeaUploadFiles(client, orgId, log, now);

    expect(calls.listed).toEqual([{ folder: `${orgId}/idea-imports`, options: { limit: 100, offset: 0 } }]);
    expect(removed).toEqual([`${orgId}/idea-imports/old.xlsx`]);
    expect(calls.removed).toEqual([[`${orgId}/idea-imports/old.xlsx`]]);
  });

  it('1 ページ（100 件）を超えても続きのページを見て、古いファイルを取り残さない', async () => {
    const fresh = Array.from({ length: 100 }, (_, index) => ({ name: `fresh-${index}.xlsx`, id: `f-${index}`, created_at: iso(1000) }));
    const stale = [{ name: 'old-after-page-1.xlsx', id: 'old', created_at: iso(IDEA_UPLOAD_STALE_MS + 1000) }];
    const { client, calls } = makeStub({ data: [], error: null }, null, [fresh, stale]);

    const removed = await removeStaleIdeaUploadFiles(client, orgId, log, now);

    expect(calls.listed.map((call) => (call.options as { offset: number }).offset)).toEqual([0, 100]);
    expect(removed).toEqual([`${orgId}/idea-imports/old-after-page-1.xlsx`]);
  });

  it('対象が無ければ削除を呼ばない', async () => {
    const { client, calls } = makeStub({ data: [{ name: 'fresh.xlsx', id: 'id-2', created_at: iso(1000) }], error: null });
    expect(await removeStaleIdeaUploadFiles(client, orgId, log, now)).toEqual([]);
    expect(calls.removed).toEqual([]);
  });

  it('一覧・削除の失敗は throw せず空配列を返す（URL 発行を止めない）', async () => {
    const failingList = makeStub({ data: null, error: { message: 'boom' } });
    await expect(removeStaleIdeaUploadFiles(failingList.client, orgId, log, now)).resolves.toEqual([]);

    const failingRemove = makeStub(
      { data: [{ name: 'old.xlsx', id: 'id-1', created_at: iso(IDEA_UPLOAD_STALE_MS + 1000) }], error: null },
      { message: 'boom' },
    );
    await expect(removeStaleIdeaUploadFiles(failingRemove.client, orgId, log, now)).resolves.toEqual([]);
  });
});

describe('chunkArray', () => {
  it('指定サイズで分割し、端数は最後のチャンクにまとめる', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkArray([], 500)).toEqual([]);
  });
});

// =========================================================================
// マイグレーション SQL への回帰テスト（実DBを使わない机上検証。§4.1-3・§3.6）
// 「同一組織で2回連続取込が成功する」の中核は isActive の切替順にあるため、
// SQL の文面レベルで担保する。実DBでの結合検証は supabase 環境での一括検証時に行う。
// =========================================================================
describe('IDEA インポートのマイグレーション SQL（回帰）', () => {
  // テーブル・インデックス定義（idea_imports）
  const schemaSql = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260831000000_schema.sql'),
    'utf8',
  );
  // RPC 関数定義（complete_idea_import / delete_idea_import）
  const rpcSql = readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260831000002_rpc.sql'),
    'utf8',
  );

  const CREATE_FUNCTION = /create (or replace )?function/;

  /**
   * SQL 全文から `start` にマッチする位置以降を、次に `end` がマッチする位置の手前まで切り出す。
   * `end` が見つからなければ末尾まで。`start` が見つからない場合はテストを落とす。
   */
  const sliceSql = (sql: string, start: RegExp, end: RegExp): string => {
    const startMatch = start.exec(sql);
    if (!startMatch) {
      throw new Error(`SQL に ${start} が見つかりません`);
    }
    const bodyStart = startMatch.index + startMatch[0].length;
    const endMatch = end.exec(sql.slice(bodyStart));
    const to = endMatch ? bodyStart + endMatch.index : sql.length;
    return sql.slice(startMatch.index, to);
  };

  /** 関数 `fnName(argTypes)` に対する grant / revoke execute のロール一覧（空白・改行に寛容） */
  const executePrivileges = (sql: string, fnName: string, argTypes: string) => {
    const args = argTypes
      .split(',')
      .map((type) => type.trim())
      .join('\\s*,\\s*');
    const target = `execute\\s+on\\s+function\\s+${fnName}\\s*\\(\\s*${args}\\s*\\)`;
    const roleList = (verb: 'revoke' | 'grant', keyword: 'from' | 'to') =>
      [...sql.matchAll(new RegExp(`${verb}\\s+${target}\\s+${keyword}\\s+([^;]+);`, 'g'))]
        .flatMap((match) => match[1].split(','))
        .map((role) => role.trim());
    return {
      revokedFrom: roleList('revoke', 'from'),
      grantedTo: roleList('grant', 'to'),
    };
  };

  const ideaImportsTable = sliceSql(
    schemaSql,
    /create table (if not exists )?idea_imports\b/,
    /\n\);/,
  );
  const completeIdeaImport = sliceSql(
    rpcSql,
    /create (or replace )?function complete_idea_import\b/,
    CREATE_FUNCTION,
  );
  const deleteIdeaImport = sliceSql(
    rpcSql,
    /create (or replace )?function delete_idea_import\b/,
    CREATE_FUNCTION,
  );

  it('idea_imports.isActive の既定は false（true だと2回目の取込が INSERT 時点で失敗する）', () => {
    expect(ideaImportsTable).toMatch(/"isActive"\s+boolean\s+not\s+null\s+default\s+false/);
    // 組織内で active な版は最大 1 件（部分一意インデックス）
    expect(schemaSql).toMatch(
      /create unique index (if not exists )?idea_imports_one_active_per_org\s+on\s+idea_imports\s*\(\s*"organizationId"\s*\)\s+where\s+"isActive"\s*=\s*true/,
    );
  });

  it('complete_idea_import は旧 active の false 化 → 新 active 化の順で切り替える（§4.1-3）', () => {
    const deactivateIndex = completeIdeaImport.indexOf('set "isActive" = false');
    const activateIndex = completeIdeaImport.indexOf('"isActive" = true');
    expect(deactivateIndex).toBeGreaterThan(-1);
    expect(activateIndex).toBeGreaterThan(-1);
    // 旧 false 化が新 true 化より前にあること（逆順は部分一意インデックスに衝突する）
    expect(deactivateIndex).toBeLessThan(activateIndex);
    // 未算定レコードの ideaCode 再マッピング（§3.6-2）が含まれること
    expect(completeIdeaImport).toContain('"isCalculated" = false');
    expect(completeIdeaImport).toMatch(/nf\."ideaCode" = old_f\."ideaCode"/);
  });

  it('delete_idea_import は emission_results の参照をチェックする（§3.6-4）', () => {
    expect(deleteIdeaImport).toContain('from emission_results er');
    expect(deleteIdeaImport).toContain(`errcode = '${IDEA_IMPORT_SQLSTATE.importReferenced}'`);
  });

  it('RPC の EXECUTE は service_role 限定（run_calculation_commit と同方針）', () => {
    for (const fnName of ['complete_idea_import', 'delete_idea_import']) {
      const { revokedFrom, grantedTo } = executePrivileges(rpcSql, fnName, 'uuid, uuid');
      // 既定の PUBLIC 付与（と anon / authenticated）を明示的に剥奪していること
      expect(revokedFrom).toEqual(expect.arrayContaining(['public', 'anon', 'authenticated']));
      // 付与先は service_role のみ（他ロールへの grant が 1 つでもあれば失敗）
      expect(grantedTo.length).toBeGreaterThan(0);
      expect([...new Set(grantedTo)]).toEqual(['service_role']);
    }
  });

  it('カスタム SQLSTATE が TS 側の対応表（IDEA_IMPORT_SQLSTATE）と一致する', () => {
    const ideaImportRpcSql = completeIdeaImport + deleteIdeaImport;
    expect(ideaImportRpcSql).toContain(`errcode = '${IDEA_IMPORT_SQLSTATE.importInvalid}'`);
    expect(ideaImportRpcSql).toContain(`errcode = '${IDEA_IMPORT_SQLSTATE.importReferenced}'`);
  });
});
