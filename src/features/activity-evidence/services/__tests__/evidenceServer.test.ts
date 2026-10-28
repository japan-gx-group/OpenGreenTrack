import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  EVIDENCE_BUCKET,
  EVIDENCE_QUARANTINE_BUCKET,
  buildEvidenceUploadPath,
  deleteEvidenceFile,
  finalizeEvidenceUpload,
  isEvidenceUploadPathForOrganization,
  removeStaleEvidenceUploads,
  validateEvidenceFileMeta,
} from '../evidenceServer';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const UPLOAD_ID = '33333333-3333-4333-8333-333333333333';
const caller = { id: 'user-1', organizationId: ORG };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as Logger;

/** Storage と DB の呼び出しを記録する管理クライアントの代わり */
const fakeAdmin = (options: {
  quarantineFile?: Uint8Array<ArrayBuffer> | null;
  info?: { size: number } | null;
  linkCount?: number;
  evidenceRow?: Record<string, unknown> | null;
  insertError?: unknown;
  uploadError?: { statusCode?: string; message: string };
  deleteError?: unknown;
  listed?: Array<{ id: string | null; name: string; created_at: string | null }>;
}) => {
  const calls = { removed: [] as Array<{ bucket: string; paths: string[] }>, uploaded: [] as Array<{ bucket: string; path: string; contentType: string }>, inserted: [] as Array<{ table: string; row: Record<string, unknown> }>, deleted: [] as string[] };
  const storage = {
    from: (bucket: string) => ({
      info: async () =>
        options.info === null || options.quarantineFile === null
          ? { data: null, error: { statusCode: '404', message: 'Object not found' } }
          : { data: options.info ?? { size: options.quarantineFile?.byteLength ?? 0 }, error: null },
      download: async () => ({ data: new Blob([options.quarantineFile ?? new Uint8Array()]), error: null }),
      upload: async (path: string, _bytes: Uint8Array, opts: { contentType: string }) => {
        calls.uploaded.push({ bucket, path, contentType: opts.contentType });
        return { error: options.uploadError ?? null };
      },
      remove: async (paths: string[]) => {
        calls.removed.push({ bucket, paths });
        return { error: null };
      },
      list: async () => ({ data: options.listed ?? [], error: null }),
    }),
  };
  const from = (table: string) => {
    if (table === 'system_audit_logs') {
      return { insert: async (row: Record<string, unknown>) => (calls.inserted.push({ table, row }), { error: null }) };
    }
    if (table === 'activity_record_evidence') {
      const chain = { select: () => chain, eq: async () => ({ count: options.linkCount ?? 0, error: null }) };
      return chain;
    }
    // activity_evidence_files
    return {
      insert: (row: Record<string, unknown>) => {
        calls.inserted.push({ table, row });
        return {
          select: () => ({
            single: async () =>
              options.insertError ? { data: null, error: options.insertError } : { data: { ...row, createdAt: '2026-10-26T00:00:00Z' }, error: null },
          }),
        };
      },
      select: () => {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: options.evidenceRow ?? null, error: null }) };
        return chain;
      },
      delete: () => ({
        eq: async (_column: string, id: string) => (calls.deleted.push(id), { error: options.deleteError ?? null }),
      }),
    };
  };
  return { admin: { storage, from } as unknown as SupabaseClient, calls };
};

describe('アップロードのパス', () => {
  it('自組織のフォルダの下に UUID で作り、他組織・任意のパスは認めない', () => {
    const path = buildEvidenceUploadPath(ORG, UPLOAD_ID);
    expect(path).toBe(`${ORG}/activity-evidence/${UPLOAD_ID}`);
    expect(isEvidenceUploadPathForOrganization(path, ORG)).toBe(true);
    expect(isEvidenceUploadPathForOrganization(path, OTHER_ORG)).toBe(false);
    expect(isEvidenceUploadPathForOrganization(`${ORG}/activity-evidence/../x`, ORG)).toBe(false);
    expect(isEvidenceUploadPathForOrganization(`${ORG}/idea-imports/${UPLOAD_ID}.xlsx`, ORG)).toBe(false);
  });
});

describe('validateEvidenceFileMeta', () => {
  it('PDF・PNG・JPEG・WebP の拡張子で、1〜10MB なら通す', () => {
    expect(validateEvidenceFileMeta('9月分.pdf', 1024)).toEqual({ ok: true });
    expect(validateEvidenceFileMeta('scan.JPEG', 10 * 1024 * 1024)).toEqual({ ok: true });
  });

  it('拡張子・大きさ・名前の長さが外れれば理由を返す', () => {
    expect(validateEvidenceFileMeta('memo.txt', 10)).toMatchObject({ ok: false });
    expect(validateEvidenceFileMeta('a.pdf', 0)).toEqual({ ok: false, errorMessage: 'ファイルが空です' });
    expect(validateEvidenceFileMeta('a.pdf', 10 * 1024 * 1024 + 1)).toEqual({
      ok: false,
      errorMessage: 'ファイルが大きすぎます。10MB 以下にしてください',
    });
    expect(validateEvidenceFileMeta(`${'あ'.repeat(260)}.pdf`, 10)).toEqual({
      ok: false,
      errorMessage: 'ファイル名は 255 文字以内にしてください',
    });
  });

  it('ファイル名が空なら、長さではなく名前が無いことを伝える', () => {
    expect(validateEvidenceFileMeta('  ', 10)).toEqual({
      ok: false,
      errorMessage: 'ファイル名がありません。名前の付いたファイルを選んでください',
    });
  });
});

describe('finalizeEvidenceUpload', () => {
  const storagePath = `${ORG}/activity-evidence/${UPLOAD_ID}`;

  beforeEach(() => {
    vi.mocked(log.error).mockClear();
  });

  it('中身から形式を決めて保存先へ置き、行と監査ログを作り、一時ファイルを消す', async () => {
    const { admin, calls } = fakeAdmin({ quarantineFile: PDF });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: ' 9月分.png ', convertedFrom: 'image/png', log });

    expect(result.ok).toBe(true);
    // ファイル名の拡張子（.png）ではなく、中身（%PDF-）から形式と拡張子を決める
    // 帳票の ID は一時ファイルのパスの UUID（同じアップロードの保存が 2 回届いても 1 件にするため）
    expect(calls.uploaded).toEqual([
      { bucket: EVIDENCE_BUCKET, path: `${ORG}/activity-evidence/${UPLOAD_ID}.pdf`, contentType: 'application/pdf' },
    ]);
    const row = calls.inserted.find((call) => call.table === 'activity_evidence_files')?.row;
    expect(row).toMatchObject({
      id: UPLOAD_ID,
      organizationId: ORG,
      fileName: '9月分.png',
      mimeType: 'application/pdf',
      sizeBytes: PDF.byteLength,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      // WebP でなければ、変換したという申告は記録しない
      convertedFrom: null,
      uploadedBy: 'user-1',
    });
    expect(calls.inserted.find((call) => call.table === 'system_audit_logs')?.row).toMatchObject({
      action: 'activity_evidence.upload',
      entityName: 'activity_evidence_files',
    });
    expect(calls.removed).toContainEqual({ bucket: EVIDENCE_QUARANTINE_BUCKET, paths: [storagePath] });
  });

  it('PDF・画像でなければ保存せず、一時ファイルは消す', async () => {
    const { admin, calls } = fakeAdmin({ quarantineFile: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toEqual({ ok: false, status: 400, errorMessage: 'PDF・PNG・JPEG・WebP のファイルではありません' });
    expect(calls.uploaded).toEqual([]);
    expect(calls.removed).toContainEqual({ bucket: EVIDENCE_QUARANTINE_BUCKET, paths: [storagePath] });
  });

  it('10MB を超えていれば読まずに断る', async () => {
    const { admin, calls } = fakeAdmin({ quarantineFile: PDF, info: { size: 10 * 1024 * 1024 + 1 } });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(calls.uploaded).toEqual([]);
  });

  it('一時ファイルが無ければ 400', async () => {
    const { admin } = fakeAdmin({ quarantineFile: null });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toEqual({ ok: false, status: 400, errorMessage: 'アップロードしたファイルが見つかりません。もう一度選んでください' });
  });

  it('同じアップロードの保存が先に済んでいれば、置き直さずに先の帳票を返す', async () => {
    const saved = { id: UPLOAD_ID, fileName: '9月分.pdf', storagePath: `${ORG}/activity-evidence/${UPLOAD_ID}.pdf` };
    const { admin, calls } = fakeAdmin({
      quarantineFile: PDF,
      uploadError: { statusCode: '409', message: 'The resource already exists' },
      evidenceRow: saved,
    });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toEqual({ ok: true, file: saved });
    expect(calls.inserted).toEqual([]);
    // 置いてあるファイルは先の保存のものなので消さない（一時ファイルだけを消す）
    expect(calls.removed).toEqual([{ bucket: EVIDENCE_QUARANTINE_BUCKET, paths: [storagePath] }]);
  });

  it('同じアップロードの保存が途中（ファイルはあるが行がまだ無い）なら 409', async () => {
    const { admin, calls } = fakeAdmin({
      quarantineFile: PDF,
      uploadError: { statusCode: '409', message: 'The resource already exists' },
      evidenceRow: null,
    });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(calls.removed.some((call) => call.bucket === EVIDENCE_BUCKET)).toBe(false);
  });

  it('行の ID が重なった（同じアップロードを別の形式で置き直した）ときは、置いたファイルを消して 409', async () => {
    const { admin, calls } = fakeAdmin({ quarantineFile: PDF, insertError: { code: '23505', message: 'duplicate key' } });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(calls.removed).toContainEqual({ bucket: EVIDENCE_BUCKET, paths: [`${ORG}/activity-evidence/${UPLOAD_ID}.pdf`] });
  });

  it('行を作れなければ、置いたファイルも消す', async () => {
    const { admin, calls } = fakeAdmin({ quarantineFile: PDF, insertError: { message: 'boom' } });
    const result = await finalizeEvidenceUpload({ admin, caller, storagePath, fileName: 'a.pdf', convertedFrom: null, log });
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(calls.removed.some((call) => call.bucket === EVIDENCE_BUCKET)).toBe(true);
  });
});

describe('deleteEvidenceFile', () => {
  const evidenceRow = { id: 'file-1', fileName: 'a.pdf', sizeBytes: 10, sha256: 'x'.repeat(64), storagePath: `${ORG}/activity-evidence/file-1.pdf` };

  it('どの記録にも紐づいていなければ、行・ファイルを消して監査ログを残す', async () => {
    const { admin, calls } = fakeAdmin({ evidenceRow, linkCount: 0 });
    const result = await deleteEvidenceFile({ admin, caller, id: 'file-1', log });
    expect(result).toEqual({ ok: true });
    expect(calls.deleted).toEqual(['file-1']);
    expect(calls.removed).toContainEqual({ bucket: EVIDENCE_BUCKET, paths: [evidenceRow.storagePath] });
    expect(calls.inserted.find((call) => call.table === 'system_audit_logs')?.row).toMatchObject({ action: 'activity_evidence.delete' });
  });

  it('記録に紐づいていれば 409 で、何も消さない', async () => {
    const { admin, calls } = fakeAdmin({ evidenceRow, linkCount: 2 });
    const result = await deleteEvidenceFile({ admin, caller, id: 'file-1', log });
    expect(result).toEqual({
      ok: false,
      status: 409,
      errorMessage: 'この帳票は 2 件の記録に紐づいています。記録から外してから削除してください',
    });
    expect(calls.deleted).toEqual([]);
    expect(calls.removed).toEqual([]);
  });

  it('自組織の帳票でなければ 404', async () => {
    const { admin } = fakeAdmin({ evidenceRow: null });
    expect(await deleteEvidenceFile({ admin, caller, id: 'file-1', log })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('removeStaleEvidenceUploads', () => {
  it('24 時間を過ぎた一時ファイルだけを消す（フォルダ・日時の無いものは残す）', async () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const { admin, calls } = fakeAdmin({
      listed: [
        { id: 'a', name: 'old', created_at: '2026-10-25T11:00:00Z' },
        { id: 'b', name: 'new', created_at: '2026-10-26T11:00:00Z' },
        { id: null, name: 'folder', created_at: null },
      ],
    });
    expect(await removeStaleEvidenceUploads(admin, ORG, log, now)).toEqual([`${ORG}/activity-evidence/old`]);
    expect(calls.removed).toEqual([{ bucket: EVIDENCE_QUARANTINE_BUCKET, paths: [`${ORG}/activity-evidence/old`] }]);
  });
});
