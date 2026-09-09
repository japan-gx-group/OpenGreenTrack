// supabase/seeds/<set>/*.sql を稼働中の DB へ投入するスクリプト（npm run db:seed:demo / db:seed:production）。
//
// 実行: node scripts/db/seed.ts <production|demo> [--db-url <url>] [--force] [--container <name>]
//   （Node 24 は TypeScript を直接実行できる。依存ライブラリなし）
//   production … supabase/seeds/production/*.sql — 本番でも投入する共通マスタ（公式排出係数）
//   demo       … supabase/seeds/demo/*.sql       — テスト・デモ専用データ（デモ組織・デモユーザー。本番投入禁止）
//   対象セットの *.sql をファイル名順にすべて実行する。seed は冪等（on conflict …）なので何度流してもよい。
//   migration にデータを入れず seed で投入する運用の実行手段（AGENTS.md R12）。
//
// 投入先:
//   既定      ローカル Supabase の DB コンテナ supabase_db_<project_id>（project_id は supabase/config.toml から解決。
//             --container で明示もできる）の中で psql を実行する:
//               docker exec -i <container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction -f -
//             ファイルの中身は標準入力で渡す。ローカル Supabase は Docker 上で動くため、ホストに psql は不要。
//             コンテナが動いていなければ「ローカル Supabase が起動していません（npx supabase start）」で終了コード 1。
//   --db-url  ホストの psql で任意の DB（クラウド / 自前ホスト）へ流す:
//               psql <url> -v ON_ERROR_STOP=1 --single-transaction -f <file>
//             ホストに psql が無ければ案内（Dashboard の SQL Editor でファイル内容を実行する）を出して終了コード 1。
//             demo を --db-url の DB へ流すには --force が必要。デモアカウントは公開パスワード（password123 など）を
//             使うため、本番 DB へ誤って投入しないための確認として要求する。
//
// Supabase CLI の SQL 実行サブコマンドではなく psql を使う理由:
//   CLI の SQL 実行はファイルの内容を 1 つのプリペアドステートメントとして送るため、複数の文を含むファイルは
//   `cannot insert multiple commands into a prepared statement` で失敗する。seed ファイルは数千文の insert からなるので、
//   複数文をそのまま扱えて -v ON_ERROR_STOP=1 で最初のエラーで止まる psql を使う。
//   （`supabase db reset --sql-paths …` は seed 専用の経路で流すので問題なく動く。= npm run db:reset:demo）
//
// 出力: 実行するファイルを 1 行ずつ、psql の出力はそのまま（stdout / stderr を継承）
// 終了コード: 0 = 成功 / 1 = 引数エラー・実行環境エラー（docker / psql が無い、コンテナ未起動）・SQL エラー
//             SQL エラー時は ON_ERROR_STOP により当該ファイルの途中で止まり、以降のファイルは実行しない。
//             ファイルは --single-transaction で 1 トランザクションとして流すため、途中で失敗しても
//             そのファイルの変更は丸ごとロールバックされる（demo.sql は先頭でデモ組織を削除してから
//             入れ直すので、途中で止まると「組織だけ消えた」半端な状態が残ってしまうのを防ぐ）
// 単体テスト: scripts/db/__tests__/seed.test.ts（純粋関数だけを対象にし、docker / psql / DB には触れない）

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type SeedSet = 'production' | 'demo';
export const SEED_SETS: readonly SeedSet[] = ['production', 'demo'];

/** リポジトリルート（このファイルは scripts/db/ 直下にある）。cwd に依存せず動かすための基準 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_SEEDS_DIR = path.join(REPO_ROOT, 'supabase', 'seeds');
export const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, 'supabase', 'config.toml');

export const USAGE = `使い方: node scripts/db/seed.ts <production|demo> [--db-url <url>] [--force] [--container <name>]
  supabase/seeds/<set>/*.sql をファイル名順にすべて実行する（seed は冪等なので繰り返し流してよい）。
    production          本番でも投入する共通マスタ（公式排出係数）
    demo                テスト・デモ専用データ（本番投入禁止）
  --db-url <url>      ホストの psql で指定した DB へ流す（既定: ローカル Supabase の DB コンテナ内で psql を実行）
  --force             demo を --db-url の DB へ流すことを許可する（誤って本番へ投入しないための確認）
  --container <name>  ローカル Supabase の DB コンテナ名（既定: supabase/config.toml の project_id から supabase_db_<project_id>）
  終了コード: 0 = 成功 / 1 = 引数エラー・実行環境エラー・SQL エラー`;

/** 引数の誤り（使い方を添えて終了コード 1 にする） */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface SeedOptions {
  set: SeedSet;
  /** --db-url。null なら既定のローカル Supabase コンテナ */
  dbUrl: string | null;
  force: boolean;
  /** --container。null なら config.toml から解決 */
  container: string | null;
}

export type ParsedArgs = { help: true } | { help: false; options: SeedOptions };

const isSeedSet = (value: string): value is SeedSet => (SEED_SETS as readonly string[]).includes(value);

/**
 * コマンドライン引数を解釈する。値を取るオプションは `--name value` と `--name=value` の両方を受け付ける。
 * 誤りは UsageError として投げる（demo + --db-url で --force が無い場合を含む）。
 */
export const parseArgs = (argv: readonly string[]): ParsedArgs => {
  if (argv.includes('-h') || argv.includes('--help')) {
    return { help: true };
  }

  let set: SeedSet | null = null;
  let dbUrl: string | null = null;
  let force = false;
  let container: string | null = null;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    i++;

    const takeValue = (): string => {
      if (inlineValue !== null) {
        if (inlineValue === '') {
          throw new UsageError(`${name} に値を指定してください`);
        }
        return inlineValue;
      }
      const next = argv[i];
      if (next === undefined || next.startsWith('-')) {
        throw new UsageError(`${name} に値を指定してください`);
      }
      i++;
      return next;
    };

    switch (name) {
      case '--db-url':
        dbUrl = takeValue();
        break;
      case '--container':
        container = takeValue();
        break;
      case '--force':
        if (inlineValue !== null) {
          throw new UsageError('--force は値を取りません');
        }
        force = true;
        break;
      default:
        if (name.startsWith('-')) {
          throw new UsageError(`不明なオプションです: ${name}`);
        }
        if (set !== null) {
          throw new UsageError(`seed セットは 1 つだけ指定してください（${set} と ${arg} が指定されています）`);
        }
        if (!isSeedSet(arg)) {
          throw new UsageError(`seed セットは production または demo を指定してください（指定値: ${arg}）`);
        }
        set = arg;
    }
  }

  if (set === null) {
    throw new UsageError('seed セット（production または demo）を指定してください');
  }
  if (dbUrl !== null && container !== null) {
    throw new UsageError('--container と --db-url は同時に指定できません（--db-url はホストの psql で直接接続します）');
  }
  if (set === 'demo' && dbUrl !== null && !force) {
    throw new UsageError(
      'demo を --db-url で指定した DB へ投入するには --force が必要です。' +
        'デモアカウントは公開パスワード（password123 など）を使うため、本番 DB には絶対に投入しないでください',
    );
  }
  return { help: false, options: { set, dbUrl, force, container } };
};

/** ロケールに依存しない文字列順（psql / Supabase CLI のグロブ展開と同じ並び。先頭に日付や連番を付けて順序を制御する） */
const compareByCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `<seedsDir>/<set>/*.sql` を絶対パスでファイル名順に返す。
 * サブディレクトリと .sql 以外は対象外。ディレクトリが無い / 対象が 0 件なら Error を投げる。
 */
export const resolveSeedFiles = (seedsDir: string, set: SeedSet): string[] => {
  const dir = path.join(seedsDir, set);
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.name.endsWith('.sql')) {
          return false;
        }
        if (entry.isSymbolicLink()) {
          try {
            return statSync(path.join(dir, entry.name)).isFile();
          } catch {
            return false;
          }
        }
        return entry.isFile();
      })
      .map((entry) => entry.name);
  } catch {
    throw new Error(`seed ディレクトリが見つかりません: ${dir}`);
  }
  if (names.length === 0) {
    throw new Error(`seed ファイル（*.sql）がありません: ${dir}`);
  }
  return names.sort(compareByCodeUnit).map((name) => path.join(dir, name));
};

/**
 * supabase/config.toml の本文からトップレベルの `project_id = "…"` を読む（最初のテーブル見出し `[…]` 以降は見ない）。
 * TOML パーサは使わず、Supabase CLI が生成する書式（1 行 1 キー、# コメント）だけを想定する。
 */
export const projectIdFromConfig = (configToml: string): string | null => {
  for (const rawLine of configToml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[')) {
      break;
    }
    const match = /^project_id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line);
    if (match) {
      const value = match[1] ?? match[2] ?? '';
      return value === '' ? null : value;
    }
  }
  return null;
};

/** ローカル Supabase の DB コンテナ名（`supabase_db_<project_id>`。Supabase CLI の命名規則） */
export const containerNameFromConfig = (configToml: string): string => {
  const projectId = projectIdFromConfig(configToml);
  if (projectId === null) {
    throw new Error('project_id が見つかりません（--container でコンテナ名を直接指定できます）');
  }
  return `supabase_db_${projectId}`;
};

export type SeedTarget = { kind: 'docker'; container: string } | { kind: 'psql'; dbUrl: string };

export interface SeedCommand {
  command: string;
  args: string[];
  /** true なら seed ファイルの中身を標準入力で渡す（docker exec … psql -f -）。false なら psql が -f <file> で直接読む */
  pipeFileToStdin: boolean;
}

/**
 * 1 ファイルを流すコマンドを組み立てる（実行はしない）。
 * --single-transaction: seed ファイルは「削除→再投入」で冪等にしているため、途中で失敗すると削除だけが
 * 残る。1 ファイル = 1 トランザクションにして、失敗時は丸ごとロールバックさせる
 * （seed ファイル側に begin / commit や psql メタコマンドを書かないこと。入れ子になって失敗する）。
 */
export const buildCommand = (target: SeedTarget, file: string): SeedCommand => {
  if (target.kind === 'docker') {
    return {
      command: 'docker',
      args: [
        'exec',
        '-i',
        target.container,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '--single-transaction',
        '-f',
        '-',
      ],
      pipeFileToStdin: true,
    };
  }
  return {
    command: 'psql',
    args: [target.dbUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file],
    pipeFileToStdin: false,
  };
};

/** `docker ps --format {{.Names}}` の出力（1 行 1 コンテナ名）を配列にする */
export const parseContainerNames = (output: string): string[] =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** ログ表示用に接続文字列のパスワードを伏せる（URL 形式と key=value 形式の両方） */
export const redactDbUrl = (dbUrl: string): string => {
  try {
    const url = new URL(dbUrl);
    if (url.password !== '') {
      url.password = '***';
    }
    return url.href;
  } catch {
    return dbUrl.replace(/password=\S+/gi, 'password=***');
  }
};

const describeTarget = (target: SeedTarget): string =>
  target.kind === 'docker'
    ? `ローカル Supabase（DB コンテナ ${target.container}）`
    : `${redactDbUrl(target.dbUrl)}（ホストの psql）`;

// ---- ここから下は実行環境に触れる（単体テストの対象外） ----

type ContainerListResult = { ok: true; names: string[] } | { ok: false; message: string };

const listRunningContainers = (): ContainerListResult => {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return {
      ok: false,
      message:
        code === 'ENOENT'
          ? 'docker コマンドが見つかりません。ローカル Supabase は Docker 上で動作します（Docker を導入・起動してから npx supabase start）'
          : `docker ps を実行できません: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message: `docker ps が失敗しました（Docker が起動しているか確認してください）: ${result.stderr.trim()}`,
    };
  }
  return { ok: true, names: parseContainerNames(result.stdout) };
};

const hostPsqlAvailable = (): boolean => {
  const result = spawnSync('psql', ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
};

/** 1 ファイルを実行し、psql の終了コードを返す（起動失敗は 1） */
const runSeedFile = (target: SeedTarget, file: string): number => {
  const cmd = buildCommand(target, file);
  const result = cmd.pipeFileToStdin
    ? spawnSync(cmd.command, cmd.args, { input: readFileSync(file), stdio: ['pipe', 'inherit', 'inherit'] })
    : spawnSync(cmd.command, cmd.args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`seed: ${cmd.command} を起動できません: ${result.error.message}`);
    return 1;
  }
  if (result.status === null) {
    console.error(`seed: ${cmd.command} がシグナル ${result.signal ?? '不明'} で終了しました`);
    return 1;
  }
  return result.status;
};

const relative = (file: string): string => path.relative(REPO_ROOT, file);

const main = (argv: string[]): number => {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`seed: ${error.message}\n\n${USAGE}`);
      return 1;
    }
    throw error;
  }
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const { set, dbUrl, container } = parsed.options;

  let files: string[];
  try {
    files = resolveSeedFiles(DEFAULT_SEEDS_DIR, set);
  } catch (error) {
    console.error(`seed: ${(error as Error).message}`);
    return 1;
  }

  let target: SeedTarget;
  if (dbUrl !== null) {
    if (!hostPsqlAvailable()) {
      console.error(
        'seed: ホストに psql が見つかりません。PostgreSQL クライアント（psql）をインストールするか、\n' +
          '      Supabase Dashboard の SQL Editor で次のファイルの内容をそのまま実行してください:',
      );
      for (const file of files) {
        console.error(`        - ${relative(file)}`);
      }
      return 1;
    }
    target = { kind: 'psql', dbUrl };
    if (set === 'demo') {
      // parseArgs が --force を要求済み。ここに来た時点で明示的に許可されている
      console.error('seed: 注意 — --force により demo データを --db-url の DB へ投入します。本番プロジェクトには投入しないでください');
    }
  } else {
    let name = container;
    if (name === null) {
      try {
        name = containerNameFromConfig(readFileSync(DEFAULT_CONFIG_PATH, 'utf8'));
      } catch (error) {
        console.error(`seed: ${relative(DEFAULT_CONFIG_PATH)}: ${(error as Error).message}`);
        return 1;
      }
    }
    const running = listRunningContainers();
    if (!running.ok) {
      console.error(`seed: ${running.message}`);
      return 1;
    }
    if (!running.names.includes(name)) {
      console.error(`seed: ローカル Supabase が起動していません（npx supabase start）— DB コンテナ ${name} が見つかりません`);
      return 1;
    }
    target = { kind: 'docker', container: name };
  }

  console.log(`seed: ${set}（${files.length} ファイル）→ ${describeTarget(target)}`);
  for (const [index, file] of files.entries()) {
    console.log(`seed: [${index + 1}/${files.length}] ${relative(file)}`);
    const status = runSeedFile(target, file);
    if (status !== 0) {
      console.error(
        `seed: 中断 — ${relative(file)} でエラー（psql 終了コード ${status}）。` +
          'ON_ERROR_STOP により最初のエラーで停止し、以降のファイルは実行していません',
      );
      return 1;
    }
  }
  console.log(`seed: 完了 — ${set} を ${describeTarget(target)} へ投入しました`);
  return 0;
};

/**
 * `node scripts/db/seed.ts …` として直接実行されたときだけ CLI を動かす（テストから import しても副作用なし）。
 * 両辺とも realpath で比較する: Node は ESM のエントリをシンボリックリンク解決後のパスで import.meta.url にするが、
 * argv[1] は入力どおりのため、シンボリックリンク経由のチェックアウト（macOS の /tmp 配下や外部ボリュームへのリンク等）
 * で単純比較すると false になり、CLI が何もせず終了コード 0 で終わってしまう。
 */
const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectRun()) {
  process.exitCode = main(process.argv.slice(2));
}
