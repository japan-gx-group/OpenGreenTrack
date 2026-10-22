// git の pre-push フック（lefthook.yml の pre-push から use_stdin: true で呼ばれる）。
//
// 入力: 標準入力に git が渡す行「<local ref> <local sha> <remote ref> <remote sha>」（push する ref ごとに 1 行）
// 検査:
//   1. remote ref が refs/heads/main なら拒否する（main への直接 push。ruleset でも拒否されるが、push 前に気付ける）
//   2. push するコミット範囲で既存マイグレーションが変わっていないか（AGENTS.md R9。CI の Harness Guard と同じ検査）
// 終了コード: 問題なし = 0 / 問題あり = 1（git が push を中止する）
// 人間・エージェントのどちらが push しても同じように動く。AI エージェント用ハーネス（docs/agent-harness.md）の層 3。

import { readFileSync } from 'node:fs';
import { formatViolation, runCheck } from '../db/check-migration-immutability.ts';

const ZERO_SHA = /^0+$/;

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  input = '';
}

const lines = input
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0);

let failed = false;
for (const line of lines) {
  const [localRef, localSha, remoteRef] = line.split(/\s+/);
  if (!remoteRef) continue;
  if (ZERO_SHA.test(localSha ?? '')) continue; // ブランチ削除の push（ローカル側が 0）。削除自体は ruleset が守る

  if (remoteRef === 'refs/heads/main') {
    console.error(`pre-push: main への直接 push は禁止です（${localRef} → ${remoteRef}）。トピックブランチへ push して PR を作ってください（AGENTS.md R11）。`);
    failed = true;
    continue;
  }

  const result = runCheck(process.cwd(), 'committed');
  if (result.error) {
    console.warn(`pre-push: マイグレーション不変性の検査を実行できませんでした（${result.error}）。CI で検査されます。`);
    continue;
  }
  if (result.violations.length > 0) {
    console.error(`pre-push: 既存マイグレーションが変更されています（AGENTS.md R9。基準 ${result.baseRef}）:`);
    for (const v of result.violations) console.error(`  ${formatViolation(v)}`);
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
