// 1 つの組織のデータ（OGT 本体と SSBJ）の件数を確かめ、書き出し、削除するスクリプト。
// 手順は docs/backup-restore-and-data-return.md。対象のテーブルは scripts/ops/orgDataTables.ts。
//
// 実行: node scripts/ops/org-data.ts <summary|export|delete> --org <組織ID> [オプション]
//   （Node 24 は TypeScript を直接実行できる。依存ライブラリなし）
//   summary … 組織のデータの件数とチェックサムを出す。バックアップから復元した前後で比べ、壊れていないことを確かめる
//   export  … 組織のデータを、テーブルごとの JSON Lines と件数の一覧（manifest.json）に書き出す（組織に返すため）
//   delete  … 組織のデータを削除する。既定は試行（消える件数を出して、元に戻す）。--execute で実際に消し、削除の記録を残す
//
// 接続先は scripts/db/seed.ts と同じ:
//   既定      ローカル Supabase の DB コンテナ（supabase/config.toml の project_id から supabase_db_<project_id>）の中で psql を実行する
//   --db-url-from-env  ホストの psql で、環境変数 OGT_DB_URL の DB に接続する（接続文字列をコマンドの引数に出さない。ps で見えるため）
//   --db-url  ホストの psql で任意の DB に接続する（引数は ps で見えるので、共用のマシンでは --db-url-from-env を使う）
//   ホストの psql には、パスワードを除いた接続文字列を引数で、パスワードを環境変数 PGPASSWORD で渡す（psql の引数も ps で見えるため）。
//   ホストの psql は 10 以上が要る（SQL で \if を使う）。
// service_role キーは使わない（DB に postgres ユーザーで接続し、RLS の対象外で読む・消す）。
//
// 安全のための決まり:
//   - どのサブコマンドも、始めに DB の組織に属するテーブル（"organizationId" の列か organizations への外部キーを持つもの）が
//     一覧（orgDataTables.ts）にそろっているかを確かめる。一覧に無いテーブルがあれば何もせずに止まる
//     （DB より古いチェックアウトで実行して、書き出しや削除の確認から漏れないように）
//   - 書き出し先・削除の記録の保存先は、リポジトリの外に限る（組織のデータをコミットしてしまわないため）
//   - 書き出しは 1 つのトランザクション（repeatable read・read only）で読み、テーブルごとの行数を DB の件数と照らし合わせる
//   - 削除は 1 つのトランザクション（repeatable read）で行い、確定の前に「この組織の行が 0 件」
//     「ほかの組織の行の件数とチェックサムが変わっていない」を確かめる。満たさなければ何も消さずに止まる
//   - 実際に削除するには --execute・--confirm-name（DB の組織名と一致すること）・--record をそろえる
//   - 削除の記録は、削除を始める前に status: started（確定したかまだ分からない）で作る（作れなければ何も消さない）。
//     確定の後に status: committed で書き直し、書き直せなければ記録の JSON を画面に出す（削除したのに記録が無い、を起こさないため）
//   - OGT 本体の監査ログ（system_audit_logs）は、組織への外部キーが意図的に on delete restrict。消してよいかを本体のメンテナーと
//     合意するまで既定では消さず、監査ログのある組織は何も消さずに止まる。--delete-audit-logs を明示したときだけ、先に消す。
//     SSBJ の操作履歴（ssbj_audit_logs）も同じ監査ログとして扱う（連鎖削除で消えるので、既定では、あれば止まる）
//
// 出力: 結果の表（summary は --json で JSON）。終了コード: 0 = 成功 / 1 = 引数エラー・実行環境エラー・SQL エラー・確認の失敗
// 単体テスト: scripts/ops/__tests__/org-data.test.ts（純粋関数だけを対象にし、docker / psql / DB には触れない）

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containerNameFromConfig, DEFAULT_CONFIG_PATH, parseContainerNames } from '../db/seed.ts';
import { ORG_DATA_TABLES, type OrgDataTable, SHARED_TABLES } from './orgDataTables.ts';

/** リポジトリルート（このファイルは scripts/ops/ 直下にある） */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type OrgDataCommand = 'summary' | 'export' | 'delete';
export const ORG_DATA_COMMANDS: readonly OrgDataCommand[] = ['summary', 'export', 'delete'];

export const USAGE = `使い方: node scripts/ops/org-data.ts <summary|export|delete> --org <組織ID> [オプション]
  summary                    組織のデータの件数とチェックサムを出す（バックアップから復元した前後で比べる）
    --json                   結果を JSON で出す
  export                     組織のデータを書き出す（テーブルごとの JSON Lines と manifest.json）
    --out <ディレクトリ>     書き出し先。まだ無いか空のディレクトリで、リポジトリの外に限る
  delete                     組織のデータを削除する。既定は試行（消える件数を出して、元に戻す）
    --execute                実際に削除する
    --confirm-name <組織名>  実際に削除するとき、DB の組織名と同じ名前を指定する（取り違え防止）
    --record <ファイル>      実際に削除するとき、削除の記録（JSON）の保存先。リポジトリの外に限る
    --delete-audit-logs      監査ログ（OGT 本体の system_audit_logs・SSBJ の ssbj_audit_logs）も消す（Issue #160 で合意するまで使わない）
  共通
    --org <組織ID>           対象の組織（UUID）
    --db-url-from-env        ホストの psql で、環境変数 OGT_DB_URL の DB に接続する（既定: ローカル Supabase の DB コンテナ）
    --db-url <url>           ホストの psql で指定した DB に接続する（引数は ps で見えるので、--db-url-from-env を勧める）
    --container <name>       ローカル Supabase の DB コンテナ名（既定: supabase/config.toml の project_id から）
  終了コード: 0 = 成功 / 1 = 引数エラー・実行環境エラー・SQL エラー・確認の失敗`;

/** 引数の誤り（使い方を添えて終了コード 1 にする） */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface OrgDataOptions {
  command: OrgDataCommand;
  organizationId: string;
  dbUrl: string | null;
  container: string | null;
  json: boolean;
  out: string | null;
  execute: boolean;
  confirmName: string | null;
  record: string | null;
  deleteAuditLogs: boolean;
}

/** --db-url-from-env で読む環境変数の名前。 */
export const DB_URL_ENV = 'OGT_DB_URL';

export type ParsedArgs = { help: true } | { help: false; options: OrgDataOptions };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 組織 ID の形式（UUID）。SQL に値として埋め込むため、形式の合わないものは受け付けない。 */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/**
 * コマンドライン引数を解釈する。値を取るオプションは `--name value` と `--name=value` の両方を受け付ける。
 * 誤りは UsageError として投げる（サブコマンドに関係しないオプションの指定も誤りにする）。
 */
export const parseArgs = (argv: readonly string[], env: Readonly<Record<string, string | undefined>> = process.env): ParsedArgs => {
  if (argv.includes('-h') || argv.includes('--help')) {
    return { help: true };
  }

  let command: OrgDataCommand | null = null;
  const values = new Map<string, string>();
  const flags = new Set<string>();

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    i++;

    const takeValue = (): string => {
      if (inlineValue !== null) {
        if (inlineValue === '') throw new UsageError(`${name} に値を指定してください`);
        return inlineValue;
      }
      const next = argv[i];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${name} に値を指定してください`);
      i++;
      return next;
    };

    switch (name) {
      case '--org':
      case '--db-url':
      case '--container':
      case '--out':
      case '--confirm-name':
      case '--record':
        if (values.has(name)) throw new UsageError(`${name} は 1 回だけ指定してください`);
        values.set(name, takeValue());
        break;
      case '--json':
      case '--execute':
      case '--delete-audit-logs':
      case '--db-url-from-env':
        if (inlineValue !== null) throw new UsageError(`${name} は値を取りません`);
        flags.add(name);
        break;
      default:
        if (name.startsWith('-')) throw new UsageError(`不明なオプションです: ${name}`);
        if (command !== null) throw new UsageError(`サブコマンドは 1 つだけ指定してください（${command} と ${arg}）`);
        if (!(ORG_DATA_COMMANDS as readonly string[]).includes(arg)) {
          throw new UsageError(`サブコマンドは summary・export・delete のどれかを指定してください（指定値: ${arg}）`);
        }
        command = arg as OrgDataCommand;
    }
  }

  if (command === null) throw new UsageError('サブコマンド（summary・export・delete）を指定してください');
  const organizationId = values.get('--org');
  if (organizationId === undefined) throw new UsageError('--org で組織 ID を指定してください');
  if (!isUuid(organizationId)) throw new UsageError(`組織 ID は小文字の UUID で指定してください（指定値: ${organizationId}）`);
  if (values.has('--db-url') && flags.has('--db-url-from-env')) {
    throw new UsageError('--db-url と --db-url-from-env は同時に指定できません');
  }
  const dbUrlFromEnv = flags.has('--db-url-from-env') ? env[DB_URL_ENV] : undefined;
  if (flags.has('--db-url-from-env') && !dbUrlFromEnv) {
    throw new UsageError(`--db-url-from-env には、環境変数 ${DB_URL_ENV} に接続文字列を入れてください`);
  }
  const dbUrl = values.get('--db-url') ?? dbUrlFromEnv ?? null;
  if (dbUrl !== null && values.has('--container')) {
    throw new UsageError('--container と --db-url（--db-url-from-env）は同時に指定できません（ホストの psql で直接接続します）');
  }

  const allowed: Record<OrgDataCommand, string[]> = {
    summary: ['--json'],
    export: ['--out'],
    delete: ['--execute', '--confirm-name', '--record', '--delete-audit-logs'],
  };
  const commandOptions = ['--json', '--out', '--execute', '--confirm-name', '--record', '--delete-audit-logs'];
  for (const option of commandOptions) {
    if ((values.has(option) || flags.has(option)) && !allowed[command].includes(option)) {
      throw new UsageError(`${option} は ${command} では使えません`);
    }
  }
  if (command === 'export' && !values.has('--out')) throw new UsageError('export には --out で書き出し先を指定してください');
  const execute = flags.has('--execute');
  if (command === 'delete' && execute && (!values.has('--confirm-name') || !values.has('--record'))) {
    throw new UsageError('実際に削除する（--execute）には、--confirm-name <組織名> と --record <ファイル> も指定してください');
  }
  if (command === 'delete' && !execute && (values.has('--confirm-name') || values.has('--record'))) {
    throw new UsageError('--confirm-name と --record は --execute と一緒に指定してください（指定が無ければ試行です）');
  }

  return {
    help: false,
    options: {
      command,
      organizationId,
      dbUrl,
      container: values.get('--container') ?? null,
      json: flags.has('--json'),
      out: values.get('--out') ?? null,
      execute,
      confirmName: values.get('--confirm-name') ?? null,
      record: values.get('--record') ?? null,
      deleteAuditLogs: flags.has('--delete-audit-logs'),
    },
  };
};

// ---- SQL の組み立て（psql に標準入力で渡す。組織 ID は isUuid で確かめた値だけを埋め込む） ----

/** psql の出力の中で、スクリプトが区切りに使う行の先頭。JSON の行（{ で始まる）と混ざらない。 */
export const MARKER = '@@ogt-org-data@@';

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const assertUuid = (organizationId: string): void => {
  if (!isUuid(organizationId)) throw new Error(`組織 ID の形式が正しくありません: ${organizationId}`);
};

/** この組織の行を選ぶ条件（t はテーブルの別名）。 */
export const organizationFilter = (table: OrgDataTable, organizationId: string): string => {
  assertUuid(organizationId);
  return `t.${ident(table.organizationColumn)} = ${literal(organizationId)}::uuid`;
};

const orderBy = (table: OrgDataTable): string => table.primaryKey.map(column => `t.${ident(column)}`).join(', ');

/** 行を 1 行の JSON にする式（書き出さない列を除く）。JSON は改行を含まないため、1 行 = 1 件になる。 */
export const exportRowExpression = (table: OrgDataTable): string => {
  const omit = table.omitColumns ?? [];
  return omit.length === 0
    ? 'to_jsonb(t)::text'
    : `(to_jsonb(t) - array[${omit.map(literal).join(', ')}]::text[])::text`;
};

/** 組織のユーザー（profiles がこの組織を指す auth.users）を選ぶ条件（u は auth.users の別名）。 */
const authUserFilter = (organizationId: string): string =>
  `u.id in (select p.id from public.profiles p where p."organizationId" = ${literal(organizationId)}::uuid)`;

/**
 * 削除で消す組織のユーザーの ID を控える一時表。組織を消すと profiles が連鎖削除で消え、authUserFilter では選べなくなるため、
 * 消す前に控えて、ユーザーの削除と削除の後の確認に使う。
 */
const DELETED_USERS_TABLE = 'ogt_org_data_users';
const deletedUserFilter = `u.id in (select id from ${DELETED_USERS_TABLE})`;

/** Storage にあるこの組織のファイル（パスの先頭のフォルダが組織 ID）を選ぶ条件。 */
const storageFilter = (organizationId: string): string =>
  `(storage.foldername(o.name))[1] = ${literal(organizationId)}`;

/** Storage のテーブルがあるときだけ実行する（Supabase の Storage を使わない DB でも動くように）。 */
const ifStorage = (sql: string): string =>
  `select to_regclass('storage.objects') is not null as has_storage \\gset\n\\if :has_storage\n${sql}\n\\endif`;

/** 組織が無ければ止める。 */
const requireOrganization = (organizationId: string): string => `do $$
begin
  if not exists (select 1 from public.organizations where id = ${literal(organizationId)}::uuid) then
    raise exception '組織が見つかりません: %', ${literal(organizationId)};
  end if;
end
$$;`;

/** 組織名を出す（区切りの行のあとに 1 行）。 */
const organizationNameSql = (organizationId: string): string =>
  `\\echo ${MARKER} organization\nselect name from public.organizations where id = ${literal(organizationId)}::uuid;`;

/**
 * DB にある組織に属するテーブルが、一覧（ORG_DATA_TABLES か SHARED_TABLES）にそろっていなければ止める。
 * 組織に属するテーブルは、public スキーマで "organizationId" の列か organizations への外部キーを持つもの。
 * DB より古いチェックアウトでスクリプトを動かすと、増えたテーブルが書き出し・削除の確認から漏れるため、毎回 DB で確かめる。
 */
export const buildTableCheckSql = (): string => {
  const listed = [...ORG_DATA_TABLES.map(table => table.name), ...Object.keys(SHARED_TABLES)];
  return `do $$
declare
  missing text;
begin
  select string_agg(c.relname::text, ', ' order by c.relname) into missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
    and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organizationId' and a.attnum > 0 and not a.attisdropped)
      or exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'f' and k.confrelid = 'public.organizations'::regclass))
    and c.relname::text <> all (array[${listed.map(literal).join(', ')}]::text[]);
  if missing is not null then
    raise exception '組織のデータの一覧（scripts/ops/orgDataTables.ts）に無い、組織に属するテーブルが DB にあります: %。リポジトリを DB と同じか新しい版にしてから実行してください（何もしていません）', missing;
  end if;
end
$$;`;
};

/**
 * summary の SQL。テーブルごとに「件数|チェックサム」を出す（auth.users と Storage は件数だけ）。
 * チェックサムは、行の JSON の md5 を主キー順につないだものの md5（全列を使う。書き出さない列も含める）。
 */
export const buildSummarySql = (organizationId: string): string => {
  const rows = ORG_DATA_TABLES.map(table =>
    `select ${literal(table.name)}, count(*), coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' order by ${orderBy(table)})), '') ` +
    `from public.${ident(table.name)} t where ${organizationFilter(table, organizationId)}`);
  return [
    '\\set ON_ERROR_STOP 1',
    'begin isolation level repeatable read read only;',
    buildTableCheckSql(),
    requireOrganization(organizationId),
    organizationNameSql(organizationId),
    `\\echo ${MARKER} summary`,
    `${rows.join('\nunion all\n')}\nunion all\nselect 'auth.users', count(*), '' from auth.users u where ${authUserFilter(organizationId)};`,
    ifStorage(`select 'storage.objects', count(*), '' from storage.objects o where ${storageFilter(organizationId)};`),
    `\\echo ${MARKER} end`,
    'commit;',
  ].join('\n');
};

/** export の SQL。テーブルごとに区切りの行・行の JSON・件数を出す（1 つのトランザクションで読む）。 */
export const buildExportSql = (organizationId: string): string => {
  const tables = ORG_DATA_TABLES.map(table => [
    `\\echo ${MARKER} table ${table.name}`,
    `select ${exportRowExpression(table)} from public.${ident(table.name)} t where ${organizationFilter(table, organizationId)} order by ${orderBy(table)};`,
    `\\echo ${MARKER} count ${table.name}`,
    `select count(*) from public.${ident(table.name)} t where ${organizationFilter(table, organizationId)};`,
  ].join('\n'));
  return [
    '\\set ON_ERROR_STOP 1',
    'begin isolation level repeatable read read only;',
    buildTableCheckSql(),
    requireOrganization(organizationId),
    organizationNameSql(organizationId),
    ...tables,
    `\\echo ${MARKER} count auth.users`,
    `select count(*) from auth.users u where ${authUserFilter(organizationId)};`,
    ifStorage([
      `\\echo ${MARKER} table storage.objects`,
      'select jsonb_build_object(\'bucket\', o.bucket_id, \'name\', o.name, \'createdAt\', o.created_at, ' +
        `'size', o.metadata ->> 'size', 'mimeType', o.metadata ->> 'mimetype')::text from storage.objects o where ${storageFilter(organizationId)} order by o.bucket_id, o.name;`,
      `\\echo ${MARKER} count storage.objects`,
      `select count(*) from storage.objects o where ${storageFilter(organizationId)};`,
    ].join('\n')),
    `\\echo ${MARKER} end`,
    'commit;',
  ].join('\n');
};

/**
 * 削除の前後で比べる値（テーブルごとに、この組織の行数・ほかの組織の行数・ほかの組織の行のチェックサム）。
 * auth.users はログインのたびに行が変わるため、チェックサムは比べない（件数だけ）。
 */
const snapshotSql = (organizationId: string, tempTable: string, userFilter: string): string => {
  const rows = ORG_DATA_TABLES.map(table => {
    const own = organizationFilter(table, organizationId);
    return `select ${literal(table.name)} as name, count(*) filter (where ${own}) as target_rows, ` +
      `count(*) filter (where (${own}) is not true) as other_rows, ` +
      `coalesce(md5(string_agg(md5(to_jsonb(t)::text), '' order by ${orderBy(table)}) filter (where (${own}) is not true)), '') as other_checksum ` +
      `from public.${ident(table.name)} t`;
  });
  const authUsers = `select 'auth.users', count(*) filter (where ${userFilter}), ` +
    `count(*) filter (where not (${userFilter})), '' from auth.users u`;
  return `create temp table ${tempTable} on commit drop as\n${[...rows, authUsers].join('\nunion all\n')};`;
};

/**
 * delete の SQL。repeatable read の 1 つのトランザクションで、消す前の値を取り、消し、確定の前に確かめる。
 * 試行（execute = false）は最後に rollback し、実際の削除（execute = true）は commit する。
 * 消す順番: 組織のユーザーの ID を控える →（deleteAuditLogs のときだけ）system_audit_logs → organizations（profiles と
 * ほかのテーブルは連鎖削除）→ 控えた ID のユーザー（auth.users）。
 * ユーザーを組織より先に消すと、最後の管理者の profiles が消えるところで、組織の管理者を 0 人にしないトリガー
 * （ensure_organization_keeps_admin）に止められる。組織ごと消すときは、このトリガーは止めない。
 * system_audit_logs は organizations への外部キーが意図的に on delete restrict（スキーマの §7）。消してよいかを本体のメンテナーと
 * 合意するまで、既定では消さずに、監査ログがあれば何も消さずに止める（本体の設計判断をこのスクリプトで変えないため）。
 * SSBJ の操作履歴（ssbj_audit_logs）は連鎖削除で消えるが、同じ監査ログなので、system_audit_logs と同じく既定では止める。
 * commit は最後の区切りの行（end）の後に置く。psql が失敗したとき、出力に end が無ければ確定していないと分かる（psqlFailure）。
 */
export const buildDeleteSql = (organizationId: string, execute: boolean, deleteAuditLogs = false): string => {
  const org = `${literal(organizationId)}::uuid`;
  return [
    '\\set ON_ERROR_STOP 1',
    'begin isolation level repeatable read;',
    buildTableCheckSql(),
    requireOrganization(organizationId),
    organizationNameSql(organizationId),
    // Storage のファイルは SQL で消すと実体が残るため、このスクリプトでは消さない。残っていれば止める（手順書の §「Storage」）。
    ifStorage(`do $$
begin
  if exists (select 1 from storage.objects o where ${storageFilter(organizationId)}) then
    raise exception 'Storage にこの組織のファイルが残っています。先に Storage から消してください（手順書の「Storage のファイル」）';
  end if;
end
$$;`),
    deleteAuditLogs ? '' : `do $$
begin
  if exists (select 1 from public.system_audit_logs where "organizationId" = ${org})
    or exists (select 1 from public.ssbj_audit_logs where "organizationId" = ${org}) then
    raise exception 'この組織には監査ログ（OGT 本体の system_audit_logs か SSBJ の操作履歴 ssbj_audit_logs）があります。監査ログを消してよいかは Issue #160 で合意してから進めてください（合意前は何も消しません）';
  end if;
end
$$;`,
    `create temp table ${DELETED_USERS_TABLE} on commit drop as select p.id from public.profiles p where p."organizationId" = ${org};`,
    snapshotSql(organizationId, 'ogt_org_data_before', deletedUserFilter),
    deleteAuditLogs ? `delete from public.system_audit_logs where "organizationId" = ${org};` : '',
    `delete from public.organizations where id = ${org};`,
    `delete from auth.users u where ${deletedUserFilter};`,
    snapshotSql(organizationId, 'ogt_org_data_after', deletedUserFilter),
    `do $$
declare
  r record;
begin
  for r in
    select b.name, a.target_rows as remaining, b.other_rows as other_before, a.other_rows as other_after,
      b.other_checksum as checksum_before, a.other_checksum as checksum_after
    from ogt_org_data_before b join ogt_org_data_after a using (name)
  loop
    if r.remaining <> 0 then
      raise exception '削除の後も、この組織の行が残っています: %（% 件）', r.name, r.remaining;
    end if;
    if r.other_before <> r.other_after or r.checksum_before <> r.checksum_after then
      raise exception 'ほかの組織の行が変わりました: %（件数 % → %）', r.name, r.other_before, r.other_after;
    end if;
  end loop;
end
$$;`,
    `\\echo ${MARKER} result`,
    'select name, target_rows, other_rows from ogt_org_data_before;',
    `\\echo ${MARKER} end`,
    execute ? 'commit;' : 'rollback;',
  ].join('\n');
};

// ---- psql の出力の読み取り ----

export interface SummaryRow {
  name: string;
  rows: number;
  checksum: string;
}

export interface DeleteRow {
  name: string;
  /** この組織の行数（削除で消える行数） */
  targetRows: number;
  /** ほかの組織の行数（削除で変わらないことを確かめた行数） */
  otherRows: number;
}

/** 区切りの行ごとに、続く行をまとめる（区切りの行の残りの部分をキーにする）。 */
export const splitSections = (output: string): Map<string, string[]> => {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith(`${MARKER} `)) {
      const key = line.slice(MARKER.length + 1).trim();
      if (sections.has(key)) throw new Error(`psql の出力に同じ区切りが 2 回あります: ${key}`);
      current = [];
      sections.set(key, current);
    } else if (current !== null && line !== '') {
      current.push(line);
    }
  }
  if (!sections.has('end')) throw new Error('psql の出力が途中で終わっています（最後の区切りがありません）');
  return sections;
};

const toCount = (value: string | undefined, label: string): number => {
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`${label} の件数を読み取れません: ${value ?? '（無し）'}`);
  return Number(value);
};

export const organizationNameFrom = (sections: Map<string, string[]>): string => {
  const name = sections.get('organization')?.[0];
  if (name === undefined) throw new Error('組織名を読み取れません');
  return name;
};

export const parseSummaryOutput = (output: string): { organizationName: string; rows: SummaryRow[] } => {
  const sections = splitSections(output);
  const rows = (sections.get('summary') ?? []).map(line => {
    const [name, count, checksum = ''] = line.split('|');
    return { name, rows: toCount(count, name), checksum };
  });
  return { organizationName: organizationNameFrom(sections), rows };
};

export interface ExportedTable {
  name: string;
  /** 行の JSON（1 行 = 1 件） */
  lines: string[];
  /** 同じトランザクションで数えた DB 上の件数 */
  databaseRows: number;
}

export interface ParsedExport {
  organizationName: string;
  tables: ExportedTable[];
  authUsers: number;
}

/** export の出力を読む。書き出した行数と DB 上の件数が合わなければ Error を投げる。 */
export const parseExportOutput = (output: string): ParsedExport => {
  const sections = splitSections(output);
  const names = [...sections.keys()].filter(key => key.startsWith('table ')).map(key => key.slice('table '.length));
  const tables = names.map(name => {
    const lines = sections.get(`table ${name}`) ?? [];
    const databaseRows = toCount(sections.get(`count ${name}`)?.[0], name);
    if (lines.length !== databaseRows) {
      throw new Error(`${name}: 書き出した行数（${lines.length}）と DB 上の件数（${databaseRows}）が一致しません`);
    }
    for (const line of lines) {
      if (!line.startsWith('{')) throw new Error(`${name}: 行を JSON として読み取れません: ${line.slice(0, 80)}`);
    }
    return { name, lines, databaseRows };
  });
  const expected = ORG_DATA_TABLES.map(table => table.name);
  const missing = expected.filter(name => !names.includes(name));
  if (missing.length > 0) throw new Error(`書き出されていないテーブルがあります: ${missing.join(', ')}`);
  return {
    organizationName: organizationNameFrom(sections),
    tables,
    authUsers: toCount(sections.get('count auth.users')?.[0], 'auth.users'),
  };
};

export const parseDeleteOutput = (output: string): { organizationName: string; rows: DeleteRow[] } => {
  const sections = splitSections(output);
  const rows = (sections.get('result') ?? []).map(line => {
    const [name, target, other] = line.split('|');
    return { name, targetRows: toCount(target, name), otherRows: toCount(other, name) };
  });
  return { organizationName: organizationNameFrom(sections), rows };
};

// ---- 書き出し・記録のファイル ----

/** child がディレクトリ parent の中（parent 自身を含む）にあるか。`..data` のような名前は中にあるものとして扱う。 */
export const isInsideDirectory = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  const goesUp = relative === '..' || relative.startsWith(`..${path.sep}`);
  return !goesUp && !path.isAbsolute(relative);
};

/** 存在する一番近い祖先まで realpath で解決する（シンボリックリンク経由でリポジトリの中を指すのを見逃さない）。 */
const resolveReal = (target: string): string => {
  const absolute = path.resolve(target);
  const missing: string[] = [];
  let current = absolute;
  while (!existsSync(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(realpathSync(current), ...missing);
};

/** 組織のデータを置いてよい場所か（リポジトリの外）。置けなければ理由を返す。 */
export const outsideRepositoryError = (target: string, repoRoot: string = REPO_ROOT): string | null =>
  isInsideDirectory(resolveReal(repoRoot), resolveReal(target))
    ? `リポジトリの中には書き出せません（組織のデータをコミットしてしまわないため）: ${target}`
    : null;

/**
 * 削除の記録の保存先として使えるか（リポジトリの外・まだ無い・置くディレクトリがある）。使えなければ理由を返す。
 * 削除を始める前に確かめる。書けるかどうかは、この後に記録を排他的に作って確かめる（runDelete）。
 */
export const deletionRecordPathError = (record: string, repoRoot: string = REPO_ROOT): string | null => {
  const inside = outsideRepositoryError(record, repoRoot);
  if (inside) return inside;
  if (existsSync(record)) return `削除の記録の保存先がすでにあります（上書きしないため）: ${record}`;
  const directory = path.dirname(path.resolve(record));
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return `削除の記録を置くディレクトリがありません: ${directory}`;
  }
  return null;
};

const sha256 = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex');

export interface ExportManifest {
  kind: 'ogt-organization-export';
  organization: { id: string; name: string };
  exportedAt: string;
  source: string;
  tables: { name: string; rows: number; file: string; sha256: string; omittedColumns: string[] }[];
  authUsers: { rows: number; note: string };
  notes: string[];
}

/** 書き出すファイル（ファイル名 → 中身）と manifest を作る。 */
export const buildExportFiles = (
  parsed: ParsedExport, organizationId: string, exportedAt: string, source: string,
): { files: Map<string, string>; manifest: ExportManifest } => {
  const files = new Map<string, string>();
  const tables = parsed.tables.map(table => {
    const file = `${table.name}.jsonl`;
    const content = table.lines.length === 0 ? '' : `${table.lines.join('\n')}\n`;
    files.set(file, content);
    const omittedColumns = ORG_DATA_TABLES.find(entry => entry.name === table.name)?.omitColumns ?? [];
    return { name: table.name, rows: table.databaseRows, file, sha256: sha256(content), omittedColumns };
  });
  const manifest: ExportManifest = {
    kind: 'ogt-organization-export',
    organization: { id: organizationId, name: parsed.organizationName },
    exportedAt,
    source,
    tables,
    authUsers: { rows: parsed.authUsers, note: 'ログインの情報（auth.users）は書き出さない。利用者の名前・メールアドレス・ロールは profiles にある' },
    notes: [
      '各ファイルは 1 行 1 件の JSON（JSON Lines）。列名は DB と同じ',
      'rows は、書き出しと同じトランザクションで数えた DB 上の件数（書き出した行数と一致することを確かめてある）',
      'omittedColumns は、認証に使う値のため書き出していない列',
      'storage.objects は Storage にあるファイルの一覧（中身は含まない）',
    ],
  };
  files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, manifest };
};

export interface DeletionRecord {
  kind: 'ogt-organization-deletion';
  /** started = 削除を始める前に書いた（確定したかはまだ分からない）/ committed = 削除を確定した */
  status: 'started' | 'committed';
  organization: { id: string; name: string };
  startedAt: string;
  /** 削除を確定した日時（started のあいだは null） */
  finishedAt: string | null;
  target: string;
  operator: string;
  tables: DeleteRow[];
  checks: string[];
  /** 監査ログ（system_audit_logs）の扱い */
  auditLogs: string;
  note?: string;
}

/** 削除を始める前に作る記録（このまま残っていれば、確定したか分からないことを中身に書く）。 */
export const buildStartedDeletionRecord = (params: {
  organizationId: string; organizationName: string; startedAt: string; target: string; operator: string; deleteAuditLogs: boolean;
}): DeletionRecord => ({
  kind: 'ogt-organization-deletion',
  status: 'started',
  organization: { id: params.organizationId, name: params.organizationName },
  startedAt: params.startedAt,
  finishedAt: null,
  target: params.target,
  operator: params.operator,
  tables: [],
  checks: [],
  auditLogs: params.deleteAuditLogs ? '消す指定（--delete-audit-logs）' : '消さない（監査ログのある組織は消さずに止める）',
  note: '削除を始める前に書いた記録。status が started のまま残っているときは、削除が確定したか分からない。summary で組織が残っているか確かめる',
});

/** 削除を確定した後の記録（始める前の記録を書き直す）。 */
export const buildCommittedDeletionRecord = (
  started: DeletionRecord, rows: DeleteRow[], finishedAt: string, deleteAuditLogs: boolean,
): DeletionRecord => ({
  ...started,
  status: 'committed',
  finishedAt,
  tables: rows,
  checks: ['削除の後、この組織の行が 0 件', 'ほかの組織の行の件数とチェックサム（auth.users は件数）が削除の前と同じ'],
  auditLogs: deleteAuditLogs ? '消した（--delete-audit-logs）' : '無かった（監査ログのある組織は消さずに止める）',
  note: undefined,
});

const recordJson = (record: DeletionRecord): string => `${JSON.stringify(record, null, 2)}\n`;

/**
 * psql の接続文字列から、パスワードを除いた接続文字列（psql の引数に渡す）と、パスワード（環境変数 PGPASSWORD で渡す）に分ける。
 * psql の引数は同じマシンのほかの利用者から ps で見えるため。
 * URI（postgresql://user:password@host/db?sslmode=require）は libpq と同じ読み方で、user の後の : から @ までと、
 * クエリの password= を取り出す。ほかのクエリ（sslmode など）は書かれたまま残す（%XX は psql が読む）。
 * key=value 形式でパスワードを含むものは、取り出しを誤らないよう受け付けない（URI で指定してもらう）。
 */
export const psqlConnection = (dbUrl: string): { args: string[]; env: Record<string, string> } => {
  const decode = (value: string): string => {
    try {
      return decodeURIComponent(value);
    } catch {
      throw new Error('接続文字列の %XX の書き方が正しくありません');
    }
  };
  const uri = /^(postgres(?:ql)?:\/\/)(?:([^@/]*)@)?([\s\S]*)$/.exec(dbUrl);
  if (uri === null) {
    if (/(^|\s)password\s*=/i.test(dbUrl)) {
      throw new Error('パスワードを含む接続文字列は postgresql:// で始まる形で指定してください（psql の引数にパスワードを出さないため）');
    }
    return { args: [dbUrl], env: {} };
  }
  const [, scheme, userInfo = null, rest] = uri;
  let password: string | null = null;
  let user = userInfo;
  if (userInfo !== null && userInfo.includes(':')) {
    user = userInfo.slice(0, userInfo.indexOf(':'));
    const value = userInfo.slice(userInfo.indexOf(':') + 1);
    if (value !== '') password = decode(value);
  }
  const queryStart = rest.indexOf('?');
  let base = rest;
  if (queryStart !== -1) {
    base = rest.slice(0, queryStart);
    const params = rest.slice(queryStart + 1).split('&').filter(param => {
      const eq = param.indexOf('=');
      if (eq === -1 || decode(param.slice(0, eq)) !== 'password') return true;
      // クエリの password は、user の後のものより優先される（libpq と同じ）。空なら指定が無いのと同じ。
      const value = decode(param.slice(eq + 1));
      if (value !== '') password = value;
      return false;
    });
    if (params.length > 0) base = `${base}?${params.join('&')}`;
  }
  const url = `${scheme}${user ? `${user}@` : ''}${base}`;
  return { args: [url], env: password === null ? {} : { PGPASSWORD: password } };
};

/** psql の失敗。commitUnknown は、確定（commit）したかどうか分からないとき true。 */
export class PsqlError extends Error {
  readonly commitUnknown: boolean;
  constructor(message: string, commitUnknown: boolean) {
    super(message);
    this.name = 'PsqlError';
    this.commitUnknown = commitUnknown;
  }
}

/**
 * psql が失敗したときのエラーを作る。mayCommit は、SQL の最後で commit する実行（delete --execute）のとき true。
 * commit は最後の区切りの行（end）の後にあるため、出力に end が無ければ確定の前に止まっている（何も変えていない）。
 * end まで進んでいた、または psql が途中で止められた（出力が残っていない）ときは、確定したか分からない。
 */
export const psqlFailure = (detail: string, stdout: string, interrupted: boolean, mayCommit: boolean): PsqlError => {
  const reachedEnd = stdout.split(/\r?\n/).includes(`${MARKER} end`);
  if (mayCommit && (reachedEnd || interrupted)) {
    return new PsqlError(
      `psql がエラーで終了しました。削除が確定したかは分かりません。summary で組織が残っているか確かめてください:\n${detail}`, true,
    );
  }
  return new PsqlError(`psql がエラーで終了しました（何も変えていません）:\n${detail}`, false);
};

// ---- ここから下は実行環境に触れる（単体テストの対象外） ----

type Target =
  | { kind: 'docker'; container: string }
  | { kind: 'psql'; connection: { args: string[]; env: Record<string, string> } };

const describeTarget = (target: Target): string =>
  target.kind === 'docker'
    ? `ローカル Supabase（DB コンテナ ${target.container}）`
    // connection.args はパスワードを除いた接続文字列（psqlConnection）。
    : `${target.connection.args[0]}（ホストの psql）`;

const resolveTarget = (options: OrgDataOptions): Target | string => {
  if (options.dbUrl !== null) {
    let connection: { args: string[]; env: Record<string, string> };
    try {
      connection = psqlConnection(options.dbUrl);
    } catch (error) {
      return (error as Error).message;
    }
    const result = spawnSync('psql', ['--version'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) return 'ホストに psql が見つかりません。PostgreSQL クライアント（psql）をインストールしてください';
    return { kind: 'psql', connection };
  }
  let name = options.container;
  if (name === null) {
    try {
      name = containerNameFromConfig(readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
    } catch (error) {
      return `supabase/config.toml: ${(error as Error).message}`;
    }
  }
  const listed = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (listed.error || listed.status !== 0) return 'docker ps を実行できません（Docker が起動しているか確認してください）';
  if (!parseContainerNames(listed.stdout).includes(name)) {
    return `ローカル Supabase が起動していません（npx supabase start）— DB コンテナ ${name} が見つかりません`;
  }
  return { kind: 'docker', container: name };
};

/**
 * SQL を psql に標準入力で渡して実行し、標準出力を返す（失敗したら psql のエラーを添えて PsqlError）。
 * mayCommit は、SQL の最後で commit するとき true（失敗したときに、確定したか分からないと伝えるため）。
 */
const runPsql = (target: Target, sql: string, mayCommit = false): string => {
  const psqlArgs = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'];
  const [command, args, env] = target.kind === 'docker'
    ? ['docker', ['exec', '-i', target.container, 'psql', '-U', 'postgres', '-d', 'postgres', ...psqlArgs], process.env]
    : ['psql', [...target.connection.args, ...psqlArgs], { ...process.env, ...target.connection.env }];
  // 大きな組織の書き出しでも収まるよう、出力の上限を広げる（行はすべてメモリに載る）。
  const result = spawnSync(command, args, { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, env });
  // 起動できなかったとき（pid が無い）は、何も実行していない。
  if (result.error && !result.pid) throw new Error(`${command} を起動できません: ${result.error.message}`);
  if (result.error || result.status !== 0) {
    const detail = [result.stderr?.trim(), result.error?.message].filter(Boolean).join('\n');
    throw psqlFailure(detail, result.stdout ?? '', result.error !== undefined || result.signal !== null, mayCommit);
  }
  return result.stdout;
};

const printTable = (header: string[], rows: string[][]): void => {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');
  console.log(line(header));
  for (const row of rows) console.log(line(row));
};

const runSummary = (options: OrgDataOptions, target: Target): number => {
  const { organizationName, rows } = parseSummaryOutput(runPsql(target, buildSummarySql(options.organizationId)));
  if (options.json) {
    console.log(JSON.stringify({ organization: { id: options.organizationId, name: organizationName }, tables: rows }, null, 2));
    return 0;
  }
  console.log(`org-data: ${organizationName}（${options.organizationId}）— ${describeTarget(target)}`);
  printTable(['テーブル', '件数', 'チェックサム'], rows.map(row => [row.name, String(row.rows), row.checksum || '-']));
  return 0;
};

const runExport = (options: OrgDataOptions, target: Target): number => {
  const out = path.resolve(options.out!);
  const inside = outsideRepositoryError(out);
  if (inside) { console.error(`org-data: ${inside}`); return 1; }
  if (existsSync(out) && readdirSync(out).length > 0) {
    console.error(`org-data: 書き出し先が空ではありません（前の書き出しを上書きしないため）: ${out}`);
    return 1;
  }
  const exportedAt = new Date().toISOString();
  const parsed = parseExportOutput(runPsql(target, buildExportSql(options.organizationId)));
  const { files, manifest } = buildExportFiles(parsed, options.organizationId, exportedAt, describeTarget(target));
  mkdirSync(out, { recursive: true });
  for (const [file, content] of files) writeFileSync(path.join(out, file), content, { mode: 0o600 });
  console.log(`org-data: ${parsed.organizationName}（${options.organizationId}）を書き出しました → ${out}`);
  printTable(['テーブル', '件数（書き出し = DB）'], manifest.tables.map(table => [table.name, String(table.rows)]));
  console.log(`（auth.users ${parsed.authUsers} 件は書き出していません。利用者の情報は profiles にあります）`);
  return 0;
};

const printDeleteRows = (organizationName: string, options: OrgDataOptions, target: Target, rows: DeleteRow[]): void => {
  console.log(`org-data: ${organizationName}（${options.organizationId}）— ${describeTarget(target)}`);
  printTable(
    ['テーブル', options.execute ? '削除した件数' : '削除される件数', 'ほかの組織の件数（変わらない）'],
    rows.map(row => [row.name, String(row.targetRows), String(row.otherRows)]),
  );
};

const runDelete = (options: OrgDataOptions, target: Target): number => {
  if (!options.execute) {
    const { organizationName, rows } = parseDeleteOutput(
      runPsql(target, buildDeleteSql(options.organizationId, false, options.deleteAuditLogs)),
    );
    printDeleteRows(organizationName, options, target, rows);
    console.log('org-data: 試行です。確認のうえ元に戻したため、何も削除していません（実際に消すには --execute）');
    return 0;
  }

  const recordPath = path.resolve(options.record!);
  const pathError = deletionRecordPathError(recordPath);
  if (pathError) { console.error(`org-data: ${pathError}。何も削除していません`); return 1; }
  // 名前の確認は、削除と同じ SQL の中ではなく先に行う（違えば何も始めない）。
  const { organizationName } = parseSummaryOutput(runPsql(target, buildSummarySql(options.organizationId)));
  if (organizationName !== options.confirmName) {
    console.error(`org-data: --confirm-name が組織名と一致しません（DB の組織名: ${organizationName}）。何も削除していません`);
    return 1;
  }

  // 削除を始める前に、記録を排他的に作る（作れなければ何も消さない）。確定の後に書けず、記録が残らない事態を防ぐ。
  const started = buildStartedDeletionRecord({
    organizationId: options.organizationId,
    organizationName,
    startedAt: new Date().toISOString(),
    target: describeTarget(target),
    operator: userInfo().username,
    deleteAuditLogs: options.deleteAuditLogs,
  });
  try {
    writeFileSync(recordPath, recordJson(started), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    console.error(`org-data: 削除の記録を作れません（${(error as Error).message}）。何も削除していません`);
    return 1;
  }

  let output: string;
  try {
    output = runPsql(target, buildDeleteSql(options.organizationId, true, options.deleteAuditLogs), true);
  } catch (error) {
    console.error(`org-data: ${(error as Error).message}`);
    if (error instanceof PsqlError && !error.commitUnknown) {
      // 確定していないので、始める前に作った記録を消す（同じ保存先でやり直せるように）。
      try {
        unlinkSync(recordPath);
      } catch {
        console.error(`org-data: 始める前に作った削除の記録を消せませんでした（何も削除していないので、消してかまいません）: ${recordPath}`);
      }
    } else {
      console.error(`org-data: 始める前に作った削除の記録（status: started）を残しました。確かめた結果を書き添えて保管してください: ${recordPath}`);
    }
    return 1;
  }

  // ここまで来れば削除は確定している。出力を読めなくても、記録は残す。
  const finishedAt = new Date().toISOString();
  let rows: DeleteRow[] = [];
  let parseError: string | null = null;
  try {
    rows = parseDeleteOutput(output).rows;
    printDeleteRows(organizationName, options, target, rows);
  } catch (error) {
    parseError = (error as Error).message;
    console.error(`org-data: 削除は確定しましたが、psql の出力を読み取れませんでした: ${parseError}`);
  }
  const record = buildCommittedDeletionRecord(started, rows, finishedAt, options.deleteAuditLogs);
  if (parseError !== null) record.note = `削除は確定したが、テーブルごとの件数を読み取れなかった: ${parseError}`;
  try {
    writeFileSync(recordPath, recordJson(record), { mode: 0o600 });
  } catch (error) {
    console.error(`org-data: 削除は確定しました。ただし削除の記録を ${recordPath} に書けませんでした（${(error as Error).message}）。`);
    console.error('org-data: 標準出力に出した次の JSON を、削除の記録として保存してください:');
    console.log(recordJson(record).trimEnd());
    return 1;
  }
  console.log(`org-data: 削除しました。削除の記録 → ${recordPath}`);
  return parseError === null ? 0 : 1;
};

const main = (argv: string[]): number => {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`org-data: ${error.message}\n\n${USAGE}`);
      return 1;
    }
    throw error;
  }
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const { options } = parsed;
  const target = resolveTarget(options);
  if (typeof target === 'string') {
    console.error(`org-data: ${target}`);
    return 1;
  }
  try {
    if (options.command === 'summary') return runSummary(options, target);
    if (options.command === 'export') return runExport(options, target);
    return runDelete(options, target);
  } catch (error) {
    console.error(`org-data: ${(error as Error).message}`);
    return 1;
  }
};

/** `node scripts/ops/org-data.ts …` として直接実行されたときだけ CLI を動かす（テストから import しても副作用なし）。 */
const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2));
}
