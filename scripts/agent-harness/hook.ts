// AI エージェント用ハーネスの入口。Claude Code と Codex の両方から、同じコマンドで呼ばれる。
//
//   Claude Code: .claude/settings.json の hooks → sh "$CLAUDE_PROJECT_DIR/scripts/agent-harness/hook.sh"
//   Codex      : .codex/config.toml の [hooks]  → sh "$(git rev-parse --show-toplevel)/scripts/agent-harness/hook.sh"
//   hook.sh は node（24 以上）の有無を確かめてからこのファイルを実行する。node が無い・壊れている場合は
//   PreToolUse だけ 2（拒否）を返す（fail-closed。それ以外のイベントは止めない）。
//
// どちらも標準入力に JSON（hook_event_name / tool_name / tool_input / cwd …）を流し、終了コードで結果を受け取る:
//   0 … 通過（SessionStart では標準出力の文章がエージェントの文脈に追加される）
//   2 … 拒否（標準エラーの文章が理由としてエージェントに返る。PreToolUse ならツールは実行されない、
//            Stop ならエージェントは作業を続けさせられる）
//   それ以外 … ハーネス自身のエラー（拒否にはならない。PreToolUse だけは fail-closed で 2 を返す）
//
// イベントごとの役割:
//   SessionStart … ハーネスが有効であることと主な制限を 1 度だけ伝える
//   PreToolUse   … Bash コマンドとファイル書き込み（Edit / Write / apply_patch）を policy.ts に照らす
//   PostToolUse  … マイグレーションを書いたら check:migrations を即時実行、package.json を書いたら依存の追加を検出
//   Stop         … 作業ツリーの差分に秘密情報が無いか、既存マイグレーションが変わっていないか、依存が増えていないかを最後に確認
//
// 判定ロジックは guard.ts（純関数）、ルールは policy.ts。このファイルは I/O だけを持つ。
// 拒否した操作は <repo>/.agent-harness-audit.jsonl に 1 行ずつ追記する（.gitignore 済み。ルール ID だけを残し、
// コマンド文字列やパスは残さない。コマンドに秘密情報の値が含まれていてもログに写らないようにするため）。

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateBashCommand,
  evaluateFileWrite,
  extractPatchPaths,
  resolvePath,
  scanDiffForSecrets,
  scanTextForSecrets,
  toRepoRelative,
  type DenyReason,
} from './guard.ts';
import { AUDIT_LOG_FILE, NO_AUDIT_ENV, UNLOCK_ENV } from './policy.ts';
import { existsInRef, formatViolation, resolveBaseRef, runCheck } from '../db/check-migration-immutability.ts';

interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  stop_hook_active?: boolean;
  scratchpad_dir?: string;
}

interface Env {
  repoRoot: string;
  cwd: string;
  homeDir: string;
  unlocked: boolean;
  tmpDirs: string[];
  agent: 'claude' | 'codex' | 'unknown';
}

const FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS: ReadonlySet<string> = new Set(['Bash', 'exec_command', 'shell', 'local_shell', 'container.exec']);

const git = (args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const detectEnv = (payload: HookPayload): Env => {
  const cwd = payload.cwd && path.isAbsolute(payload.cwd) ? payload.cwd : process.cwd();
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  const repoRoot = top.ok ? top.stdout.trim() : (process.env.CLAUDE_PROJECT_DIR ?? cwd);
  const homeDir = os.homedir();
  const tmpDirs = [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', process.env.TMPDIR, payload.scratchpad_dir]
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .map((d) => d.replace(/\/$/, ''));
  let agent: Env['agent'] = 'unknown';
  if (process.env.CLAUDE_PROJECT_DIR) agent = 'claude';
  else if (process.env.CODEX_HOME || process.env.CODEX_SANDBOX_NETWORK_DISABLED !== undefined) agent = 'codex';
  return { repoRoot, cwd, homeDir, unlocked: process.env[UNLOCK_ENV] === '1', tmpDirs, agent };
};

const shellQuote = (t: string): string => (/^[\w./:=@%+-]+$/.test(t) ? t : `'${t.replace(/'/g, "'\\''")}'`);

const commandOf = (input: Record<string, unknown>): string => {
  const c = input.command ?? input.cmd ?? input.script;
  if (Array.isArray(c)) return c.map((t) => shellQuote(String(t))).join(' ');
  return typeof c === 'string' ? c : '';
};

const filePathsOf = (toolName: string, input: Record<string, unknown>): string[] => {
  if (toolName === 'apply_patch') {
    const patch = [input.command, input.patch, input.input].find((v) => typeof v === 'string');
    return typeof patch === 'string' ? extractPatchPaths(patch) : [];
  }
  const p = [input.file_path, input.notebook_path, input.path].find((v) => typeof v === 'string');
  return typeof p === 'string' ? [p] : [];
};

/** 監査ログ。ルール ID だけを残す（コマンド文字列・パス・理由文は書かない） */
const audit = (env: Env, payload: HookPayload, reasons: DenyReason[]): void => {
  if (process.env[NO_AUDIT_ENV] === '1') return;
  try {
    const line = {
      ts: new Date().toISOString(),
      agent: env.agent,
      session: payload.session_id ?? null,
      event: payload.hook_event_name,
      tool: payload.tool_name ?? null,
      rules: reasons.map((r) => r.id),
    };
    appendFileSync(path.join(env.repoRoot, AUDIT_LOG_FILE), `${JSON.stringify(line)}\n`);
  } catch {
    // 監査ログが書けなくても判定には影響させない
  }
};

const formatReasons = (title: string, reasons: DenyReason[]): string =>
  [
    `[OpenGreenTrack ハーネス] ${title}`,
    ...reasons.map((r) => `- (${r.id}) ${r.reason}\n    対象: ${r.detail}`),
    '詳細: docs/agent-harness.md。判断に迷う操作は実行せず、人間に確認する。',
  ].join('\n');

// ---------------------------------------------------------------------------------------------
// イベント処理
// ---------------------------------------------------------------------------------------------

const onSessionStart = (env: Env): number => {
  const base = resolveBaseRef(env.repoRoot);
  const lines = [
    '[OpenGreenTrack ハーネス] このリポジトリではツール実行の直前にガードが動き、次の操作は理由付きで拒否されます:',
    '  main への直接 push / force push / PR のマージ・承認 / リモート Supabase への操作（db push, link, secrets, --linked）/',
    '  既存マイグレーションの編集・削除 / .env・認証情報の読み書き / 新しいライブラリの追加（npm install <pkg>, npm pkg set）/',
    '  ハーネス設定（.claude/ .codex/ .github/workflows/ scripts/agent-harness/ lefthook*.yml .git/ AGENTS.md CLAUDE.md）の書き換え',
    '  （bash -c / xargs / if … の中に包んでも、git -C / gh -R でオプションを挟んでも同じ判定になります）',
    '開発規約の正本は AGENTS.md。コミット前に npm run lint / typecheck / test / build / check:migrations を通すこと。',
    '仕組みの説明と、止められたときの対処は docs/agent-harness.md。',
  ];
  if (base.fallback) lines.push('注意: origin/main が取得されていないため、マイグレーション不変性の判定は HEAD を基準にしています（git fetch origin main を推奨）。');
  if (env.unlocked) lines.push(`注意: ${UNLOCK_ENV}=1 のため、ハーネスの保護対象パスの書き換えが解除されています（人間が意図して設定したセッションです）。`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
};

const onPreToolUse = (env: Env, payload: HookPayload): number => {
  const toolName = payload.tool_name ?? '';
  const input = payload.tool_input ?? {};
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], env.repoRoot);

  if (SHELL_TOOLS.has(toolName)) {
    const command = commandOf(input);
    if (!command) return 0;
    const decision = evaluateBashCommand(command, {
      repoRoot: env.repoRoot,
      cwd: env.cwd,
      homeDir: env.homeDir,
      currentBranch: branch.ok ? branch.stdout.trim() : null,
      unlocked: env.unlocked,
      tmpDirs: env.tmpDirs,
    });
    if (decision.allowed) return 0;
    audit(env, payload, decision.reasons);
    process.stderr.write(`${formatReasons('このコマンドは実行できません。', decision.reasons)}\n`);
    return 2;
  }

  if (FILE_TOOLS.has(toolName) || toolName === 'apply_patch') {
    const base = resolveBaseRef(env.repoRoot);
    const reasons: DenyReason[] = [];
    for (const p of filePathsOf(toolName, input)) {
      const decision = evaluateFileWrite(p, {
        repoRoot: env.repoRoot,
        cwd: env.cwd,
        homeDir: env.homeDir,
        unlocked: env.unlocked,
        tmpDirs: env.tmpDirs,
        existsInBase: (rel) => existsInRef(env.repoRoot, base.ref, rel),
      });
      reasons.push(...decision.reasons);
    }
    if (reasons.length === 0) return 0;
    audit(env, payload, reasons);
    process.stderr.write(`${formatReasons('このファイルは書き換えられません。', reasons)}\n`);
    return 2;
  }
  return 0;
};

const readJson = (text: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** package.json の依存セクションに新しいキーが増えていないか（R1 を Edit ツール経由でも守る） */
const newDependencies = (env: Env, baseRef: string): string[] => {
  const before = git(['show', `${baseRef}:package.json`], env.repoRoot);
  const prev = before.ok ? readJson(before.stdout) : null;
  let current: Record<string, unknown> | null = null;
  try {
    current = readJson(readFileSync(path.join(env.repoRoot, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  if (!prev || !current) return [];
  const added: string[] = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const a = (prev[section] ?? {}) as Record<string, unknown>;
    const b = (current[section] ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(b)) if (!(key in a)) added.push(`${section}: ${key}`);
  }
  return added;
};

const newDependenciesProblem = (env: Env): string | null => {
  const base = resolveBaseRef(env.repoRoot);
  const added = newDependencies(env, base.ref);
  if (added.length === 0) return null;
  return `package.json に依存が追加されています（${added.join(', ')}）。新しいライブラリの追加は禁止（AGENTS.md §1）。元に戻し、必要なら Issue / PR コメントで提案する`;
};

const onPostToolUse = (env: Env, payload: HookPayload): number => {
  const toolName = payload.tool_name ?? '';
  if (!FILE_TOOLS.has(toolName) && toolName !== 'apply_patch') return 0;
  const touched = filePathsOf(toolName, payload.tool_input ?? {})
    .map((p) => toRepoRelative(resolvePath(env.cwd, p), env.repoRoot))
    .filter((p): p is string => p !== null);
  const problems: string[] = [];

  if (touched.some((p) => p.startsWith('supabase/migrations/'))) {
    const r = spawnSync('node', [path.join(env.repoRoot, 'scripts/db/check-migrations.ts')], { cwd: env.repoRoot, encoding: 'utf8' });
    if (r.status !== 0) problems.push(`マイグレーションに DML が含まれています（AGENTS.md R12）。データは supabase/seeds/ に置く:\n${(r.stdout + r.stderr).trim()}`);
  }

  if (touched.includes('package.json')) {
    const problem = newDependenciesProblem(env);
    if (problem) problems.push(problem);
  }

  if (problems.length === 0) return 0;
  audit(env, payload, problems.map((p) => ({ id: 'post-edit-check', reason: p, detail: touched.join(', ') })));
  process.stderr.write(`[OpenGreenTrack ハーネス] 書き込み後の検査で問題が見つかりました。次の作業の前に直してください。\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
  return 2;
};

const MAX_SCAN_BYTES = 512 * 1024;

const onStop = (env: Env, payload: HookPayload): number => {
  if (payload.stop_hook_active) return 0; // すでにこのフックの指摘で続行中。無限ループを避ける
  const problems: string[] = [];

  const diff = git(['diff', '-U0', '--no-color', 'HEAD', '--'], env.repoRoot);
  const findings = diff.ok ? scanDiffForSecrets(diff.stdout) : [];
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], env.repoRoot);
  if (untracked.ok) {
    for (const rel of untracked.stdout.split('\0').filter((p) => p.length > 0)) {
      const abs = path.join(env.repoRoot, rel);
      try {
        if (statSync(abs).size > MAX_SCAN_BYTES) continue;
        const text = readFileSync(abs, 'utf8');
        if (text.includes('\0')) continue;
        findings.push(...scanTextForSecrets(text, rel));
      } catch {
        // 読めないファイルは飛ばす
      }
    }
  }
  if (findings.length > 0) {
    problems.push(
      `作業ツリーに秘密情報らしき値があります（AGENTS.md R7）。値を削除し、実鍵なら直ちにローテーションする:\n${findings
        .map((f) => `  ${f.file}:${f.line} ${f.label} ${f.preview}`)
        .join('\n')}`,
    );
  }

  const immutability = runCheck(env.repoRoot, 'worktree');
  if (!immutability.error && immutability.violations.length > 0) {
    problems.push(`既存マイグレーションが変更されています（AGENTS.md R9）。元に戻し、変更は新しいマイグレーションで行う:\n${immutability.violations.map((v) => `  ${formatViolation(v)}`).join('\n')}`);
  }

  // シェル経由（npm install <pkg> の別名や手編集）で増えた依存も、作業を終える前に必ず見る
  const dependencies = newDependenciesProblem(env);
  if (dependencies) problems.push(dependencies);

  if (problems.length === 0) return 0;
  audit(env, payload, problems.map((p) => ({ id: 'stop-check', reason: p.split('\n')[0], detail: '' })));
  process.stderr.write(`[OpenGreenTrack ハーネス] 作業を終える前に直す必要があります。\n${problems.map((p) => `- ${p}`).join('\n')}\n`);
  return 2;
};

// ---------------------------------------------------------------------------------------------

/** 例外時に fail-closed にするかを決めるため、処理中のイベント名を覚えておく */
let currentEvent = '';

const main = (): number => {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }
  if (raw.trim().length === 0) {
    process.stderr.write('agent-harness/hook.ts: 標準入力にフックの JSON を渡してください（Claude Code / Codex のフックから呼ばれる想定です）\n');
    return 0;
  }
  let payload: HookPayload;
  try {
    payload = JSON.parse(raw) as HookPayload;
  } catch {
    // JSON が読めないときは PreToolUse らしき入力だけ拒否する（Stop で 2 を返すとエージェントが止まれなくなる）
    const preToolUse = raw.includes('"PreToolUse"');
    process.stderr.write(`[OpenGreenTrack ハーネス] フックの入力を JSON として解釈できませんでした。${preToolUse ? '安全側に倒して拒否します。' : ''}\n`);
    return preToolUse ? 2 : 1;
  }
  currentEvent = payload.hook_event_name ?? '';
  const env = detectEnv(payload);
  switch (payload.hook_event_name) {
    case 'SessionStart':
      return onSessionStart(env);
    case 'PreToolUse':
      return onPreToolUse(env, payload);
    case 'PostToolUse':
      return onPostToolUse(env, payload);
    case 'Stop':
      return onStop(env, payload);
    default:
      return 0;
  }
};

try {
  process.exitCode = main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[OpenGreenTrack ハーネス] 内部エラー: ${message}\n`);
  // PreToolUse の判定中に落ちた場合だけ fail-closed にする（それ以外のイベントはエージェントを止めない）
  process.exitCode = currentEvent === 'PreToolUse' ? 2 : 1;
}
