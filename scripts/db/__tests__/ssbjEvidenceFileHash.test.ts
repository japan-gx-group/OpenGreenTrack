// SSBJ 根拠文書のファイルの SHA-256（supabase/migrations/*_ssbj_evidence_file_hash.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// 対応する実装ファイルが無く、検証対象が supabase/migrations/*.sql そのものなので scripts/db/__tests__/ に置いている（AGENTS.md R13）。
// 実際の動き（形式違いのハッシュの拒否・記録日時を利用者が書けないこと・保存版と復元）はローカル DB で確かめ、
// ここでは取り違えると穴になる文面を固定する。
//
// 固定すること（後のマイグレーションで関数を定義し直したときも、最後の定義で確かめる）:
//   - SHA-256 の形式の check 制約が、画面の検証（utils/fileHash.ts の isSsbjSha256）と同じ判定をする
//   - 記録日時は利用者（authenticated）に書かせず、DB のトリガーが決める
//   - 保存版への取り込みと復元の関数が、ファイルの記録の列をすべて扱う（復元では記録日時も版のまま戻す）
//   - 保存版のキーが、画面側の型（SsbjEvidence。架空データで代表させる）のキーと一致する

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fictionalEvidence } from '@/features/ssbj/__fixtures__/fictionalReport';
import { isSsbjSha256 } from '@/features/ssbj/utils/fileHash';

const migrationsDir = path.join(process.cwd(), 'supabase/migrations');

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
const normalize = (sql: string): string =>
  sql.split(/\r?\n/).filter(line => !line.trimStart().startsWith('--')).join(' ').replace(/\s+/g, ' ');

const all = normalize(readdirSync(migrationsDir).sort().map(name => readFileSync(path.join(migrationsDir, name), 'utf8')).join('\n'));

/** 関数ごとの最後の定義（create [or replace] function … as $$ … $$;）。マイグレーションの適用順に後勝ち。 */
const latestFunctions = new Map<string, string>(
  [...all.matchAll(/create (?:or replace )?function (\w+)\(.*?\$\$.*?\$\$;/g)].map(match => [match[1], match[0]]),
);
const latest = (name: string): string => {
  const definition = latestFunctions.get(name);
  if (!definition) throw new Error(`${name} の定義が見つかりません`);
  return definition;
};

const FILE_COLUMNS = ['fileName', 'fileSha256', 'fileStorageVersionId', 'fileStoredBy', 'fileRecordedAt'];
const WRITABLE_FILE_COLUMNS = FILE_COLUMNS.filter(column => column !== 'fileRecordedAt');

describe('根拠文書のファイルの SHA-256（制約）', () => {
  it('SHA-256 の形式の check 制約は、画面の検証と同じ判定をする', () => {
    const pattern = all.match(/constraint ssbj_evidence_file_sha256_check check \("fileSha256" ~ '([^']+)'\)/)?.[1];
    expect(pattern).toBe('^[0-9a-f]{64}$');
    const database = new RegExp(pattern!);
    for (const sample of ['a'.repeat(64), '0123456789abcdef'.repeat(4), 'A'.repeat(64), 'a'.repeat(63), `g${'a'.repeat(63)}`, '']) {
      expect(database.test(sample)).toBe(isSsbjSha256(sample));
    }
  });

  it('ファイル名・SHA-256・記録日時は、3 つとも有るか 3 つとも無いかにする', () => {
    expect(all).toContain(
      'add constraint ssbj_evidence_file_record_check check ( ("fileSha256" is null) = ("fileName" is null) '
      + 'and ("fileSha256" is null) = ("fileRecordedAt" is null) )',
    );
    expect(all).toContain('add constraint ssbj_evidence_file_name_not_blank check (btrim("fileName") <> \'\')');
  });
});

describe('根拠文書のファイルの SHA-256（権限と記録日時）', () => {
  const grants = (all.match(/grant [^;]*on ssbj_evidence to authenticated;/g) ?? []);

  it('利用者はファイル名・SHA-256・保管先での版・保存担当を書けるが、記録日時は書けない', () => {
    const fileGrant = grants.find(grant => grant.includes('"fileSha256"'));
    expect(fileGrant).toBeDefined();
    for (const column of WRITABLE_FILE_COLUMNS) {
      expect(fileGrant!.match(new RegExp(`"${column}"`, 'g'))).toHaveLength(2); // insert と update
    }
    expect(grants.filter(grant => grant.includes('fileRecordedAt'))).toEqual([]);
    expect(grants.filter(grant => /grant (insert|update|all)[ ,;]/.test(grant) && !grant.includes('('))).toEqual([]);
  });

  it('記録日時はトリガーが決め、ファイル名・SHA-256 が変わったときだけ新しくする', () => {
    expect(all).toContain(
      'create trigger set_ssbj_evidence_file_recorded_at before insert or update on ssbj_evidence '
      + 'for each row execute function set_ssbj_evidence_file_recorded_at();',
    );
    const trigger = latest('set_ssbj_evidence_file_recorded_at');
    expect(trigger).toContain('if new."fileSha256" is null then new."fileRecordedAt" := null;');
    expect(trigger).toContain('new."fileRecordedAt" := coalesce(new."fileRecordedAt", now());');
    expect(trigger).toContain(
      'elsif new."fileSha256" is distinct from old."fileSha256" or new."fileName" is distinct from old."fileName" then '
      + 'new."fileRecordedAt" := now(); else new."fileRecordedAt" := old."fileRecordedAt";',
    );
  });
});

describe('根拠文書のファイルの SHA-256（保存版と復元）', () => {
  it('保存版のキーは、画面側の根拠文書の型のキーと一致する', () => {
    const snapshot = latest('ssbj_snapshot_section__evidence');
    // 開示用参照文の中（'state' / 'value'）を除いた、行の列から作るキー。
    const keys = [...snapshot.matchAll(/'(\w+)', e\.(?:"\w+"|id)/g)].map(match => match[1])
      .filter(key => key !== 'state' && key !== 'value');
    expect(keys).toEqual(expect.arrayContaining(FILE_COLUMNS));
    expect(new Set([...keys, 'disclosure'])).toEqual(new Set(Object.keys(fictionalEvidence[0])));
  });

  it('復元はファイルの記録の列をすべて戻し、記録日時も版に残っているものを使う', () => {
    const restore = latest('ssbj_restore_section__evidence');
    for (const column of FILE_COLUMNS) expect(restore).toContain(`"${column}"`);
    for (const column of WRITABLE_FILE_COLUMNS) expect(restore).toContain(`e.value ->> '${column}'`);
    expect(restore).toContain("(e.value ->> 'fileRecordedAt')::timestamptz");
  });
});
