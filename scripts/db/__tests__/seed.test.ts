// scripts/db/seed.ts の単体テスト（npm run db:seed:demo / db:seed:production の seed 投入スクリプト）。
//
// 純粋関数（parseArgs / resolveSeedFiles / containerNameFromConfig / buildCommand など）だけを対象にし、
// docker / psql / DB には一切触れない。ファイル列挙は一時ディレクトリのフィクスチャで確認する。
// 実際の投入経路（docker exec / ホスト psql）は手元のローカル Supabase で動かして確認する。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCommand,
  containerNameFromConfig,
  DEFAULT_CONFIG_PATH,
  DEFAULT_SEEDS_DIR,
  parseArgs,
  parseContainerNames,
  projectIdFromConfig,
  redactDbUrl,
  resolveSeedFiles,
  UsageError,
} from '../seed.ts';

describe('CLI エントリガード', () => {
  it('テストから import しただけでは CLI（main）が走らない', () => {
    // main が走ると引数エラーで process.exitCode = 1 になる
    expect(process.exitCode).toBeUndefined();
  });
});

describe('parseArgs: 正常系', () => {
  it('production / demo をセットとして受け付け、既定値は docker 経路になる', () => {
    expect(parseArgs(['production'])).toEqual({
      help: false,
      options: { set: 'production', dbUrl: null, force: false, container: null },
    });
    expect(parseArgs(['demo'])).toEqual({
      help: false,
      options: { set: 'demo', dbUrl: null, force: false, container: null },
    });
  });

  it('--db-url は「--db-url <url>」と「--db-url=<url>」の両方を受け付ける（URL 内の = も保持する）', () => {
    const url = 'postgresql://postgres:pw@db.example.com:5432/postgres?sslmode=require';
    expect(parseArgs(['production', '--db-url', url])).toMatchObject({ options: { dbUrl: url } });
    expect(parseArgs(['production', `--db-url=${url}`])).toMatchObject({ options: { dbUrl: url } });
  });

  it('--container でコンテナ名を上書きできる', () => {
    expect(parseArgs(['demo', '--container', 'supabase_db_other'])).toMatchObject({
      options: { set: 'demo', container: 'supabase_db_other' },
    });
    expect(parseArgs(['--container=supabase_db_other', 'demo'])).toMatchObject({
      options: { set: 'demo', container: 'supabase_db_other' },
    });
  });

  it('--force を立てられる（docker 経路では無くても受け付ける）', () => {
    expect(parseArgs(['demo', '--force'])).toMatchObject({ options: { set: 'demo', force: true } });
  });

  it('オプションはセットの前後どちらに書いてもよい', () => {
    expect(parseArgs(['--force', '--db-url', 'postgresql://h/db', 'demo'])).toMatchObject({
      options: { set: 'demo', dbUrl: 'postgresql://h/db', force: true },
    });
  });

  it('-h / --help は他の引数より優先して help になる', () => {
    expect(parseArgs(['--help'])).toEqual({ help: true });
    expect(parseArgs(['demo', '-h'])).toEqual({ help: true });
    expect(parseArgs(['--db-url', '--help'])).toEqual({ help: true });
  });
});

describe('parseArgs: 引数エラー（UsageError）', () => {
  it('セット未指定 / 不明なセット / セットの重複を拒否する', () => {
    expect(() => parseArgs([])).toThrow(UsageError);
    expect(() => parseArgs([])).toThrow('seed セット（production または demo）を指定してください');
    expect(() => parseArgs(['staging'])).toThrow('production または demo を指定してください（指定値: staging）');
    expect(() => parseArgs(['production', 'demo'])).toThrow('seed セットは 1 つだけ指定してください');
  });

  it('不明なオプションを拒否する', () => {
    expect(() => parseArgs(['demo', '--dry-run'])).toThrow('不明なオプションです: --dry-run');
    expect(() => parseArgs(['demo', '-x'])).toThrow('不明なオプションです: -x');
  });

  it('値が必要なオプションに値が無ければ拒否する', () => {
    expect(() => parseArgs(['demo', '--db-url'])).toThrow('--db-url に値を指定してください');
    expect(() => parseArgs(['demo', '--db-url', '--force'])).toThrow('--db-url に値を指定してください');
    expect(() => parseArgs(['demo', '--db-url='])).toThrow('--db-url に値を指定してください');
    expect(() => parseArgs(['demo', '--container'])).toThrow('--container に値を指定してください');
  });

  it('--force に値を付けると拒否する', () => {
    expect(() => parseArgs(['demo', '--force=1'])).toThrow('--force は値を取りません');
  });

  it('--container と --db-url の併用を拒否する', () => {
    expect(() => parseArgs(['production', '--db-url', 'postgresql://h/db', '--container', 'x'])).toThrow(
      '--container と --db-url は同時に指定できません',
    );
  });
});

describe('parseArgs: demo + --db-url は --force 必須（本番への誤投入防止）', () => {
  it('--force が無ければ拒否し、理由（公開パスワード）を説明する', () => {
    expect(() => parseArgs(['demo', '--db-url', 'postgresql://h/db'])).toThrow(UsageError);
    expect(() => parseArgs(['demo', '--db-url', 'postgresql://h/db'])).toThrow('--force が必要です');
    expect(() => parseArgs(['demo', '--db-url', 'postgresql://h/db'])).toThrow('公開パスワード');
  });

  it('--force があれば通る', () => {
    expect(parseArgs(['demo', '--db-url', 'postgresql://h/db', '--force'])).toMatchObject({
      options: { set: 'demo', dbUrl: 'postgresql://h/db', force: true },
    });
  });

  it('production + --db-url は --force 不要', () => {
    expect(parseArgs(['production', '--db-url', 'postgresql://h/db'])).toMatchObject({
      options: { set: 'production', dbUrl: 'postgresql://h/db', force: false },
    });
  });

  it('demo を既定のローカルコンテナへ流すだけなら --force 不要', () => {
    expect(parseArgs(['demo'])).toMatchObject({ options: { set: 'demo', force: false } });
    expect(parseArgs(['demo', '--container', 'supabase_db_x'])).toMatchObject({ options: { force: false } });
  });
});

describe('resolveSeedFiles', () => {
  const tempDirs: string[] = [];

  /** `<tmp>/<set>/<file>` を作る。file にスラッシュを含めるとサブディレクトリ内に作る */
  const makeSeedsDir = (layout: Record<string, string[]>): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'opengreentrack-seed-test-'));
    tempDirs.push(dir);
    for (const [set, files] of Object.entries(layout)) {
      mkdirSync(path.join(dir, set), { recursive: true });
      for (const file of files) {
        const target = path.join(dir, set, file);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, `-- ${file}\nselect 1;\n`);
      }
    }
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('指定セットの *.sql だけをファイル名順の絶対パスで返す', () => {
    const dir = makeSeedsDir({
      production: ['b_factors.sql', 'a_units.sql'],
      demo: ['demo.sql'],
    });
    expect(resolveSeedFiles(dir, 'production')).toEqual([
      path.join(dir, 'production', 'a_units.sql'),
      path.join(dir, 'production', 'b_factors.sql'),
    ]);
    expect(resolveSeedFiles(dir, 'demo')).toEqual([path.join(dir, 'demo', 'demo.sql')]);
  });

  it('.sql 以外のファイル、サブディレクトリ（*.sql という名前でも）は対象外', () => {
    const dir = makeSeedsDir({
      demo: ['demo.sql', 'README.md', 'demo.sql.bak', 'nested.sql/inner.sql', 'archive/old.sql'],
    });
    expect(resolveSeedFiles(dir, 'demo')).toEqual([path.join(dir, 'demo', 'demo.sql')]);
  });

  it('並び順はロケールに依存しない文字列順（自然順ではない。先頭の日付・連番で制御する前提）', () => {
    const dir = makeSeedsDir({
      production: ['2_a.sql', '10_b.sql', '20260831000000_x.sql'],
    });
    expect(resolveSeedFiles(dir, 'production').map((file) => path.basename(file))).toEqual([
      '10_b.sql',
      '20260831000000_x.sql',
      '2_a.sql',
    ]);
  });

  it('セットのディレクトリが無ければ Error', () => {
    const dir = makeSeedsDir({ production: ['a.sql'] });
    expect(() => resolveSeedFiles(dir, 'demo')).toThrow(`seed ディレクトリが見つかりません: ${path.join(dir, 'demo')}`);
  });

  it('*.sql が 1 つも無ければ Error', () => {
    const dir = makeSeedsDir({ demo: ['notes.md'] });
    expect(() => resolveSeedFiles(dir, 'demo')).toThrow(`seed ファイル（*.sql）がありません: ${path.join(dir, 'demo')}`);
  });

  it('リポジトリの supabase/seeds/ は production / demo とも 1 件以上ある', () => {
    const production = resolveSeedFiles(DEFAULT_SEEDS_DIR, 'production').map((file) => path.basename(file));
    const demo = resolveSeedFiles(DEFAULT_SEEDS_DIR, 'demo').map((file) => path.basename(file));
    expect(production).toContain('official_emission_factors.sql');
    expect(demo).toContain('demo.sql');
  });
});

describe('projectIdFromConfig / containerNameFromConfig', () => {
  const config = `# For detailed configuration reference documentation, visit:
# https://supabase.com/docs/guides/local-development/cli/config
# A string used to distinguish different Supabase projects on the same host.
project_id = "my-project"

[api]
enabled = true
port = 54321
`;

  it('Supabase CLI が生成する書式（先頭コメント + トップレベルの project_id）から読める', () => {
    expect(projectIdFromConfig(config)).toBe('my-project');
    expect(containerNameFromConfig(config)).toBe('supabase_db_my-project');
  });

  it('シングルクォート / 空白なし / 行末コメント / CRLF にも対応する', () => {
    expect(projectIdFromConfig("project_id = 'p1'\n")).toBe('p1');
    expect(projectIdFromConfig('project_id="p2"\n')).toBe('p2');
    expect(projectIdFromConfig('project_id = "p3" # 説明\n')).toBe('p3');
    expect(projectIdFromConfig('# head\r\nproject_id = "p4"\r\n[db]\r\n')).toBe('p4');
  });

  it('テーブル（[section]）の中にある project_id は読まない', () => {
    expect(projectIdFromConfig('[db]\nproject_id = "inside"\n')).toBeNull();
    expect(projectIdFromConfig('[db]\nport = 54322\n\nproject_id = "after"\n')).toBeNull();
  });

  it('コメントアウトされた行は読まない', () => {
    expect(projectIdFromConfig('# project_id = "commented"\n')).toBeNull();
  });

  it('project_id が無い / 空文字なら containerNameFromConfig は Error', () => {
    expect(() => containerNameFromConfig('[api]\nport = 1\n')).toThrow('project_id が見つかりません');
    expect(() => containerNameFromConfig('project_id = ""\n')).toThrow('project_id が見つかりません');
  });

  it('リポジトリの supabase/config.toml からローカル DB コンテナ名を解決できる', () => {
    const toml = readFileSync(DEFAULT_CONFIG_PATH, 'utf8');
    expect(containerNameFromConfig(toml)).toBe('supabase_db_jgx-gxtechnology-ghg-tool');
  });
});

describe('buildCommand', () => {
  const file = '/repo/supabase/seeds/demo/demo.sql';

  it('docker 経路: コンテナ内の psql に ON_ERROR_STOP と --single-transaction 付きで標準入力から流す', () => {
    expect(buildCommand({ kind: 'docker', container: 'supabase_db_my-project' }, file)).toEqual({
      command: 'docker',
      args: [
        'exec',
        '-i',
        'supabase_db_my-project',
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
    });
  });

  it('--db-url 経路: ホストの psql に URL と -f <file> を渡す（標準入力は使わない）', () => {
    const dbUrl = 'postgresql://postgres:pw@db.example.com:5432/postgres';
    expect(buildCommand({ kind: 'psql', dbUrl }, file)).toEqual({
      command: 'psql',
      args: [dbUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', file],
      pipeFileToStdin: false,
    });
  });
});

describe('seed ファイルは --single-transaction で流せる形になっている', () => {
  // psql --single-transaction は BEGIN/COMMIT で全体を包むため、ファイル側に begin / commit /
  // savepoint や、トランザクション内で実行できない文（create index concurrently / vacuum）や
  // psql メタコマンド（\\ で始まる行）があると失敗する。seed を追加・編集したときの回帰テスト。
  const forbidden = /^\s*(begin|commit|rollback|start\s+transaction|savepoint|vacuum|create\s+index\s+concurrently|\\)/i;

  for (const set of ['production', 'demo'] as const) {
    it(`${set} の seed にトランザクションと衝突する文が無い`, () => {
      for (const file of resolveSeedFiles(DEFAULT_SEEDS_DIR, set)) {
        const offending = readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((line, index) => ({ line, number: index + 1 }))
          .filter(({ line }) => forbidden.test(line));
        expect(offending, `${path.basename(file)} に --single-transaction と衝突する行があります`).toEqual([]);
      }
    });
  }
});

describe('parseContainerNames', () => {
  it('docker ps --format {{.Names}} の出力（末尾改行・空行・CRLF）を配列にする', () => {
    expect(parseContainerNames('supabase_db_x\nsupabase_kong_x\n')).toEqual(['supabase_db_x', 'supabase_kong_x']);
    expect(parseContainerNames('a\r\n\r\nb\r\n')).toEqual(['a', 'b']);
    expect(parseContainerNames('')).toEqual([]);
  });
});

describe('redactDbUrl', () => {
  it('URL のパスワードだけを伏せる', () => {
    expect(redactDbUrl('postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=require')).toBe(
      'postgresql://postgres:***@db.example.com:5432/postgres?sslmode=require',
    );
  });

  it('パスワードが無ければそのまま', () => {
    expect(redactDbUrl('postgresql://postgres@localhost:54322/postgres')).toBe(
      'postgresql://postgres@localhost:54322/postgres',
    );
  });

  it('key=value 形式の接続文字列は password= の値を伏せる', () => {
    expect(redactDbUrl('host=localhost user=postgres password=secret dbname=postgres')).toBe(
      'host=localhost user=postgres password=*** dbname=postgres',
    );
  });
});
