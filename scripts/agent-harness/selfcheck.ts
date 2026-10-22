// AI エージェント用ハーネスの配線と実動作を検査するスクリプト（npm run check:harness。CI の Harness Guard ジョブ）。
//
// 実行: node scripts/agent-harness/selfcheck.ts   （リポジトリルートで。依存ライブラリなし）
// 出力: 検査 1 件につき `ok: …` / `NG: …` を 1 行、最後に集計を 1 行
// 終了コード: すべて ok = 0 / NG あり = 1
//
// 何を守るか:
//   ハーネスは「設定ファイルが正しく hook.sh を指していること」と「hook.sh → hook.ts が止めるべきものを止めること」で成り立つ。
//   どちらが壊れても（消されても）エージェントは何も言わずに自由になるため、CI で毎回検査して赤くする（tamper-evident）。
//   単体テスト（__tests__/guard.test.ts）は判定ロジックの網羅、このスクリプトは配線と end-to-end の最小確認を担う。
//
// 検査内容:
//   1. .claude/settings.json … hooks が 4 イベントで hook.sh を呼ぶ / deny の必須項目 / bypass 無効化 / disableAllHooks が true でない
//   2. .codex/config.toml    … sandbox_mode / approval_policy が安全側 / hooks が 4 イベントで hook.sh を呼ぶ
//   3. .codex/rules/*.rules  … 代表的な forbidden ルールがある
//   4. CLAUDE.md が @AGENTS.md を取り込む / lefthook.yml・ci.yml・.gitignore・CODEOWNERS の配線 / hook.sh が hook.ts を呼ぶ
//   5. hook.sh を実際に起動し、代表的な入力で終了コードが期待どおりか（Claude Code 形式・Codex 形式の両方）。
//      node が古い環境を模した PATH でも PreToolUse が fail-closed（2）になり、Stop は止めない（1）ことも確かめる

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NO_AUDIT_ENV } from './policy.ts';

const root = process.cwd();
const results: { ok: boolean; label: string; detail?: string }[] = [];
const check = (ok: boolean, label: string, detail?: string): void => {
  results.push({ ok, label, detail });
};
const read = (rel: string): string | null => {
  const p = path.join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

const HOOK_PATH = 'scripts/agent-harness/hook.sh';
const HOOK_TS_PATH = 'scripts/agent-harness/hook.ts';
const EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'] as const;

/** 文字列を正規表現の中でそのまま一致させるためにエスケープする */
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// ---------------------------------------------------------------------------------------------
// 1. Claude Code
// ---------------------------------------------------------------------------------------------

const claudeRaw = read('.claude/settings.json');
check(claudeRaw !== null, '.claude/settings.json が存在する');
if (claudeRaw !== null) {
  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(claudeRaw) as Record<string, unknown>;
    check(true, '.claude/settings.json が JSON として読める');
  } catch (e) {
    check(false, '.claude/settings.json が JSON として読める', String(e));
  }
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  check(permissions.disableBypassPermissionsMode === 'disable', 'Claude: permissions.disableBypassPermissionsMode = "disable"');
  check(settings.disableAllHooks !== true, 'Claude: disableAllHooks が true でない');
  const deny = Array.isArray(permissions.deny) ? (permissions.deny as string[]) : [];
  for (const required of ['Read(.env.local)', 'Edit(.env.local)', 'Bash(gh pr merge *)', 'Bash(git push --force *)', 'Bash(npx supabase db push *)', 'Bash(sudo *)']) {
    check(deny.includes(required), `Claude: permissions.deny に ${required} がある`);
  }
  const hooks = (settings.hooks ?? {}) as Record<string, { matcher?: string; hooks?: { type?: string; command?: string }[] }[]>;
  for (const event of EVENTS) {
    const groups = hooks[event] ?? [];
    const wired = groups.some((g) => (g.hooks ?? []).some((h) => h.type === 'command' && (h.command ?? '').includes(HOOK_PATH)));
    check(wired, `Claude: hooks.${event} が ${HOOK_PATH} を呼ぶ`);
  }
  const pre = (hooks.PreToolUse ?? []).map((g) => g.matcher ?? '').join(' ');
  check(/\bBash\b/.test(pre) && /\bEdit\b/.test(pre) && /\bWrite\b/.test(pre), 'Claude: PreToolUse の matcher が Bash / Edit / Write を含む');
}

// ---------------------------------------------------------------------------------------------
// 2. Codex
// ---------------------------------------------------------------------------------------------

const codex = read('.codex/config.toml');
check(codex !== null, '.codex/config.toml が存在する');
if (codex !== null) {
  check(/^sandbox_mode\s*=\s*"workspace-write"/m.test(codex), 'Codex: sandbox_mode = "workspace-write"');
  check(!/^\s*sandbox_mode\s*=\s*"danger-full-access"/m.test(codex), 'Codex: sandbox_mode に danger-full-access を使っていない');
  check(/^approval_policy\s*=\s*"on-request"/m.test(codex), 'Codex: approval_policy = "on-request"');
  check(!/^approval_policy\s*=\s*"never"/m.test(codex), 'Codex: approval_policy = "never" でない');
  check(/^project_doc_max_bytes\s*=\s*\d+/m.test(codex), 'Codex: project_doc_max_bytes を上げている（AGENTS.md の切り捨て防止）');
  for (const event of EVENTS) {
    const section = new RegExp(
      `\\[\\[hooks\\.${event}\\]\\][\\s\\S]*?\\[\\[hooks\\.${event}\\.hooks\\]\\][\\s\\S]*?command\\s*=\\s*'[^']*${escapeRegExp(HOOK_PATH)}`,
    );
    check(section.test(codex), `Codex: hooks.${event} が ${HOOK_PATH} を呼ぶ`);
  }
}

const rules = read('.codex/rules/opengreentrack.rules');
check(rules !== null, '.codex/rules/opengreentrack.rules が存在する');
if (rules !== null) {
  const forbidden = (snippet: string): boolean => {
    const re = new RegExp(`prefix_rule\\([^)]*${escapeRegExp(snippet)}[^)]*decision\\s*=\\s*"forbidden"`, 's');
    return re.test(rules);
  };
  check(forbidden('["gh", "pr", "merge"]'), 'Codex rules: gh pr merge が forbidden');
  check(forbidden('"db", "push"'), 'Codex rules: supabase db push が forbidden');
  check(forbidden('["git", "push", "--force"]'), 'Codex rules: git push --force が forbidden');
  check(!/decision\s*=\s*"allow"/.test(rules), 'Codex rules: allow（サンドボックス外で承認なし実行）を使っていない');
}

// ---------------------------------------------------------------------------------------------
// 3. 周辺の配線
// ---------------------------------------------------------------------------------------------

const claudeMd = read('CLAUDE.md') ?? '';
check(/^@AGENTS\.md\s*$/m.test(claudeMd), 'CLAUDE.md が @AGENTS.md を取り込む');
const lefthook = read('lefthook.yml') ?? '';
check(lefthook.includes('check-migration-immutability'), 'lefthook.yml が check-migration-immutability を呼ぶ');
check(/^pre-push:/m.test(lefthook), 'lefthook.yml に pre-push がある');
const ci = read('.github/workflows/ci.yml') ?? '';
check(ci.includes('scripts/agent-harness/selfcheck.ts'), 'ci.yml が selfcheck.ts を呼ぶ');
check(ci.includes('scripts/db/check-migration-immutability.ts'), 'ci.yml が check-migration-immutability.ts を呼ぶ');
check(ci.includes('dependency-review-action'), 'ci.yml に Dependency Review がある');
check((read('.gitignore') ?? '').includes('.agent-harness-audit.jsonl'), '.gitignore が監査ログを除外する');
const codeowners = read('.github/CODEOWNERS') ?? '';
for (const p of ['/.claude/', '/.codex/', '/scripts/agent-harness/', '/.github/', '/AGENTS.md', '/supabase/migrations/']) {
  check(codeowners.split('\n').some((l) => l.trim().startsWith(p)), `CODEOWNERS が ${p} を含む`);
}
const hookSh = read(HOOK_PATH) ?? '';
check(hookSh.length > 0, `${HOOK_PATH} が存在する`);
check(hookSh.includes('hook.ts'), `${HOOK_PATH} が hook.ts を呼ぶ`);
check(/-lt 24\b/.test(hookSh), `${HOOK_PATH} が Node 24 未満を拒否する`);
check(existsSync(path.join(root, HOOK_TS_PATH)), `${HOOK_TS_PATH} が存在する`);

// ---------------------------------------------------------------------------------------------
// 4. hook.sh → hook.ts の実動作
// ---------------------------------------------------------------------------------------------

interface HookCase {
  label: string;
  payload: Record<string, unknown>;
  expectExit: number;
  expectStdout?: RegExp;
  raw?: string;
}

const cases: HookCase[] = [
  { label: 'SessionStart は案内を出して通す', payload: { hook_event_name: 'SessionStart', source: 'startup' }, expectExit: 0, expectStdout: /ハーネス/ },
  { label: 'Bash: npm run lint を通す', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run lint' } }, expectExit: 0 },
  { label: 'Bash: git push --force を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push --force origin feat/x' } }, expectExit: 2 },
  { label: 'Bash: git -C . push --force を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git -C . push --force origin feat/x' } }, expectExit: 2 },
  { label: 'Bash: bash -lc に包んだ force push を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'bash -lc "git push --force origin feat/x"' } }, expectExit: 2 },
  { label: 'Bash: gh pr merge を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr merge 1 --squash' } }, expectExit: 2 },
  { label: 'Bash: npx supabase db push を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx supabase db push' } }, expectExit: 2 },
  { label: 'Bash: npx supabase@latest db push を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx supabase@latest db push' } }, expectExit: 2 },
  { label: 'Bash: cat .env.local を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat .env.local' } }, expectExit: 2 },
  { label: 'Bash: npm install <pkg> を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm install lodash' } }, expectExit: 2 },
  { label: '配列形式の command でも止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { command: ['git', 'push', '--force', 'origin', 'x'] } }, expectExit: 2 },
  { label: 'Edit: src 配下を通す', payload: { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/features/x/y.ts' } }, expectExit: 0 },
  { label: 'Write: .env.local を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '.env.local' } }, expectExit: 2 },
  { label: 'Write: .claude/settings.json を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '.claude/settings.json' } }, expectExit: 2 },
  { label: 'Write: .git/hooks/pre-push を止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '.git/hooks/pre-push' } }, expectExit: 2 },
  { label: 'Edit: 既存マイグレーションを止める', payload: { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'supabase/migrations/20260831000000_schema.sql' } }, expectExit: 2 },
  { label: 'Write: 新規マイグレーション（正しい名前）を通す', payload: { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'supabase/migrations/20991231235959_selfcheck_probe.sql' } }, expectExit: 0 },
  {
    label: 'apply_patch: 既存マイグレーションの削除を止める',
    payload: { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Delete File: supabase/migrations/20260831000001_rls.sql\n*** End Patch' } },
    expectExit: 2,
  },
  { label: 'Stop: stop_hook_active なら通す', payload: { hook_event_name: 'Stop', stop_hook_active: true }, expectExit: 0 },
  { label: '不正な JSON（PreToolUse）は fail-closed で止める', payload: {}, raw: '{"hook_event_name":"PreToolUse", not json', expectExit: 2 },
  { label: '不正な JSON（Stop）は止めない（無限ループ防止）', payload: {}, raw: '{"hook_event_name":"Stop", not json', expectExit: 1 },
];

const runHook = (input: string, env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> =>
  spawnSync('sh', [path.join(root, HOOK_PATH)], { cwd: root, input, encoding: 'utf8', env });

const hookEnv = { ...process.env, [NO_AUDIT_ENV]: '1' };
for (const c of cases) {
  const input = c.raw ?? JSON.stringify({ cwd: root, session_id: 'selfcheck', ...c.payload });
  const r = runHook(input, hookEnv);
  const exitOk = r.status === c.expectExit;
  const stdoutOk = c.expectStdout ? c.expectStdout.test(String(r.stdout)) : true;
  check(exitOk && stdoutOk, `hook: ${c.label}`, exitOk ? undefined : `exit=${r.status} 期待=${c.expectExit}\n${String(r.stderr || r.stdout).trim()}`);
}

// node が古い環境を模す: バージョンを 18 と答える偽の node を PATH の先頭に置く
const fakeBin = mkdtempSync(path.join(os.tmpdir(), 'opengreentrack-selfcheck-'));
try {
  writeFileSync(path.join(fakeBin, 'node'), '#!/bin/sh\necho 18\n', { mode: 0o755 });
  const oldNodeEnv = { ...hookEnv, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` };
  const pre = runHook(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run lint' }, cwd: root }), oldNodeEnv);
  check(pre.status === 2, 'hook.sh: node が古い環境では PreToolUse を fail-closed で止める', `exit=${pre.status}\n${String(pre.stderr).trim()}`);
  const stop = runHook(JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false, cwd: root }), oldNodeEnv);
  check(stop.status === 1, 'hook.sh: node が古い環境でも Stop は止めない（無限ループ防止）', `exit=${stop.status}\n${String(stop.stderr).trim()}`);
} finally {
  rmSync(fakeBin, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`ok: ${r.label}`);
  } else {
    failed += 1;
    console.log(`NG: ${r.label}${r.detail ? `\n    ${r.detail.replace(/\n/g, '\n    ')}` : ''}`);
  }
}
console.log(failed === 0 ? `ハーネス自己診断: ${results.length} 件すべて ok` : `ハーネス自己診断: NG ${failed} 件 / ${results.length} 件`);
process.exitCode = failed === 0 ? 0 : 1;
