// supabase/migrations/ の既存ファイルが編集・削除・改名されていないか（AGENTS.md R9「マイグレーションの不変性」）を
// git の差分から検査するスクリプト。新規ファイルは `<14桁タイムスタンプ>_<snake_case>.sql` の形式であることも確認する。
//
// 実行: node scripts/db/check-migration-immutability.ts [--base <ref>] [--staged | --worktree]
//       npm run check:migration-immutability
//   （Node 24 は TypeScript を直接実行できる。依存ライブラリなし）
//   既定      … 比較基準（--base。省略時は origin/main → main → HEAD の順で最初に存在するもの）と HEAD の差分を見る。
//               CI（PR）で使う。基準と HEAD の merge-base からの差分なので、main 側が進んでいても誤検出しない
//   --staged  … ステージ済みの差分を見る。lefthook の pre-commit で使う
//   --worktree… 基準と作業ツリー（未コミット分を含む）の差分と、未追跡ファイルを見る。エージェントの Stop フックで使う
// 出力: 違反 1 件につき `supabase/migrations/<file>: <理由>` を 1 行、最後に集計を 1 行
// 終了コード: 違反なし = 0 / 違反あり = 1 / git が使えない等の実行エラー = 2
// 呼び出し元: CI（.github/workflows/ci.yml の harness ジョブ）、lefthook（pre-commit / pre-push）、
//             scripts/agent-harness/hook.ts（Stop フック。純関数だけを import する）
//
// 判定:
//   - 基準に存在するファイルの変更（M）・削除（D）・改名/複製（R / C）・種別変更（T）は違反
//   - 追加（A）はファイル名が MIGRATION_FILENAME に一致し、supabase/migrations/ 直下の .sql であれば可
//   - 基準に存在しないファイル（同じブランチで先に追加したもの）の変更は可。PR 内で作り直してよい
// 限界: 基準が取れない環境（origin/main を fetch していない）では HEAD を基準にするため、
//       コミット済みの新規ファイルの変更を違反扱いにしてしまう。CI は fetch-depth: 0 で履歴全体を取る

import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = 'supabase/migrations';

/** 新規マイグレーションのファイル名（`npx supabase migration new <name>` が作る形式） */
export const MIGRATION_FILENAME = /^\d{14}_[a-z0-9_]+\.sql$/;

export interface NameStatusEntry {
  /** git diff --name-status の状態文字（A / M / D / R / C / T …） */
  status: string;
  /** 現在のパス（リポジトリルートからの相対） */
  path: string;
  /** 改名・複製の元パス */
  oldPath?: string;
}

export interface ImmutabilityViolation {
  path: string;
  reason: string;
}

/** `git diff --name-status -z` の出力を解析する（R / C は status, old, new の 3 要素） */
export const parseNameStatus = (output: string): NameStatusEntry[] => {
  const parts = output.split('\0').filter((p) => p.length > 0);
  const entries: NameStatusEntry[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i];
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      entries.push({ status: kind, oldPath: parts[i + 1], path: parts[i + 2] });
      i += 3;
    } else {
      entries.push({ status: kind, path: parts[i + 1] });
      i += 2;
    }
  }
  return entries;
};

/** 追加されたファイルの置き場所と名前を検査する */
export const checkNewMigrationPath = (filePath: string): string | null => {
  const rel = filePath.replace(/^\.\//, '');
  if (!rel.startsWith(`${MIGRATIONS_DIR}/`)) return null;
  const rest = rel.slice(MIGRATIONS_DIR.length + 1);
  if (rest.includes('/')) return 'supabase/migrations/ 直下に置く（サブディレクトリは Supabase CLI が読まない）';
  if (!rest.endsWith('.sql')) return '.sql 以外のファイルは置かない';
  if (!MIGRATION_FILENAME.test(rest)) {
    return 'ファイル名は `<14桁タイムスタンプ>_<snake_case>.sql`（`npx supabase migration new <name>` の形式）にする';
  }
  return null;
};

export interface FindViolationsOptions {
  /** そのパスが比較基準（origin/main 等）に存在するか */
  existsInBase: (repoRelativePath: string) => boolean;
}

/** 差分のエントリから R9 違反を列挙する */
export const findImmutabilityViolations = (
  entries: readonly NameStatusEntry[],
  { existsInBase }: FindViolationsOptions,
): ImmutabilityViolation[] => {
  const violations: ImmutabilityViolation[] = [];
  for (const entry of entries) {
    const inMigrations = entry.path.startsWith(`${MIGRATIONS_DIR}/`) || (entry.oldPath ?? '').startsWith(`${MIGRATIONS_DIR}/`);
    if (!inMigrations) continue;
    switch (entry.status) {
      case 'A': {
        const problem = checkNewMigrationPath(entry.path);
        if (problem) violations.push({ path: entry.path, reason: problem });
        break;
      }
      case 'D':
        if (existsInBase(entry.path)) {
          violations.push({ path: entry.path, reason: '既存マイグレーションの削除（R9）。取り消したい変更は新しいマイグレーションで打ち消す' });
        }
        break;
      case 'R':
      case 'C': {
        const old = entry.oldPath ?? entry.path;
        if (existsInBase(old)) {
          violations.push({ path: entry.path, reason: `既存マイグレーション ${old} の改名・複製（R9）` });
        } else {
          const problem = checkNewMigrationPath(entry.path);
          if (problem) violations.push({ path: entry.path, reason: problem });
        }
        break;
      }
      case 'M':
      case 'T':
        if (existsInBase(entry.path)) {
          violations.push({ path: entry.path, reason: '既存マイグレーションの編集（R9）。変更は新しいタイムスタンプのファイルを追加して行う' });
        }
        break;
      default:
        break;
    }
  }
  return violations;
};

export const formatViolation = (v: ImmutabilityViolation): string => `${v.path}: ${v.reason}`;

// ---------------------------------------------------------------------------------------------
// git との接続（hook.ts からも使う）
// ---------------------------------------------------------------------------------------------

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export const git = (args: string[], cwd: string): GitResult => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** 比較基準の参照名を決める（origin/main → main → HEAD） */
export const resolveBaseRef = (cwd: string, explicit?: string): { ref: string; fallback: boolean } => {
  if (explicit) return { ref: explicit, fallback: false };
  for (const candidate of ['origin/main', 'main']) {
    if (git(['rev-parse', '--verify', '-q', `${candidate}^{commit}`], cwd).ok) return { ref: candidate, fallback: false };
  }
  return { ref: 'HEAD', fallback: true };
};

export const existsInRef = (cwd: string, ref: string, repoRelativePath: string): boolean =>
  git(['cat-file', '-e', `${ref}:${repoRelativePath}`], cwd).ok;

/** 基準との merge-base（取れなければ基準そのもの） */
const mergeBase = (cwd: string, ref: string): string => {
  const r = git(['merge-base', ref, 'HEAD'], cwd);
  return r.ok ? r.stdout.trim() : ref;
};

export type Mode = 'committed' | 'staged' | 'worktree';

/** 指定モードで差分エントリと未追跡ファイルを集める */
export const collectEntries = (cwd: string, mode: Mode, baseRef: string): { entries: NameStatusEntry[]; untracked: string[]; error?: string } => {
  // 改名検出は切る（--no-renames）。R9 では「元ファイルが消えて別名で現れる」も D + A として個別に判定し、
  // 削除側を必ず違反にしたいため。parseNameStatus の R / C 対応は、手動で -M 付きの出力を渡した場合のため
  const common = ['diff', '--name-status', '-z', '--no-renames'];
  let args: string[];
  if (mode === 'staged') args = [...common, '--cached', '--', MIGRATIONS_DIR];
  else if (mode === 'worktree') args = [...common, baseRef, '--', MIGRATIONS_DIR];
  else args = [...common, mergeBase(cwd, baseRef), 'HEAD', '--', MIGRATIONS_DIR];
  const diff = git(args, cwd);
  if (!diff.ok) return { entries: [], untracked: [], error: diff.stderr.trim() || 'git diff に失敗しました' };
  const entries = parseNameStatus(diff.stdout);
  let untracked: string[] = [];
  if (mode === 'worktree') {
    const u = git(['ls-files', '--others', '--exclude-standard', '-z', '--', MIGRATIONS_DIR], cwd);
    if (u.ok) untracked = u.stdout.split('\0').filter((p) => p.length > 0);
  }
  return { entries, untracked };
};

export const runCheck = (cwd: string, mode: Mode, explicitBase?: string): { violations: ImmutabilityViolation[]; baseRef: string; fallback: boolean; error?: string } => {
  const { ref, fallback } = resolveBaseRef(cwd, explicitBase);
  const { entries, untracked, error } = collectEntries(cwd, mode, ref);
  if (error) return { violations: [], baseRef: ref, fallback, error };
  const violations = findImmutabilityViolations(entries, { existsInBase: (p) => existsInRef(cwd, ref, p) });
  for (const p of untracked) {
    const problem = checkNewMigrationPath(p);
    if (problem) violations.push({ path: p, reason: problem });
  }
  return { violations, baseRef: ref, fallback };
};

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const main = (argv: string[]): number => {
  let mode: Mode = 'committed';
  let base: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--staged') mode = 'staged';
    else if (a === '--worktree') mode = 'worktree';
    else if (a === '--base') base = argv[++i];
    else if (a.startsWith('--base=')) base = a.slice('--base='.length);
    else {
      console.error(`不明な引数: ${a}`);
      return 2;
    }
  }
  const cwd = process.cwd();
  const result = runCheck(cwd, mode, base);
  if (result.error) {
    console.error(`check-migration-immutability: ${result.error}`);
    return 2;
  }
  if (result.fallback) {
    console.warn('check-migration-immutability: origin/main が無いため HEAD を基準にしています（git fetch origin main で精度が上がります）');
  }
  for (const v of result.violations) console.log(formatViolation(v));
  const n = result.violations.length;
  console.log(n === 0 ? `マイグレーションの不変性: 違反なし（基準 ${result.baseRef}, ${mode}）` : `マイグレーションの不変性: 違反 ${n} 件（基準 ${result.baseRef}, ${mode}）`);
  return n === 0 ? 0 : 1;
};

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
