# AI エージェント用ハーネス（機械的な安全装置）

このドキュメントは、Claude Code / Codex（ChatGPT）などの AI エージェントがこのリポジトリで作業するときに働く
**機械的な安全装置（ハーネス）** の設計と運用をまとめたものです。
開発規約そのものは [`AGENTS.md`](../AGENTS.md) が正本で、ハーネスは「規約のうち、守られないと取り返しがつかないもの」を
エージェントの善意に頼らず止める仕組みです。

> 対象読者: メンテナ（設定を変える人）、コントリビューター（止められたときに理由を知りたい人）、エージェント自身。

---

## 1. なぜ必要か（OSS として公開しているリポジトリの前提）

- **指示書（AGENTS.md）は約束であって強制ではない。** エージェントは文脈が長くなると規約を忘れ、プロンプトインジェクション
  （Issue 本文・外部サイト・依存パッケージの README など）で別の指示に従うことがある
- **公開リポジトリでは、入力の多くが第三者由来。** fork からの PR、Issue、`npm install` で入る依存、Web 検索結果はすべて信頼できない
- **取り返しがつかない操作が身近にある。** 本番 Supabase への `db push`、force push、`SUPABASE_SERVICE_ROLE_KEY` の露出、
  既存マイグレーションの改変（適用済み DB との食い違い）、PR の自己承認・自己マージ
- **ハーネス自身が攻撃対象になる。** 「`.claude/settings.json` の deny を消す」「`.gitleaks.toml` の allowlist を増やす」
  「AGENTS.md を書き換える」PR や、エージェント自身によるその場の書き換えを防ぐ必要がある

## 2. 設計原則

| 原則 | 具体 |
|---|---|
| **多層防御** | 指示 → 実行時ガード → git フック → CI → GitHub 保護 の 5 層。1 層が破られても次が止める |
| **単一の正本** | 「何を止めるか」は [`scripts/agent-harness/policy.ts`](../scripts/agent-harness/policy.ts) の 1 か所。Claude Code と Codex はどちらも同じ [`hook.ts`](../scripts/agent-harness/hook.ts) を呼ぶ |
| **fail-closed** | ガードが壊れた・入力が読めない・node が無い（古い）ときは「通す」のではなく「止める」（PreToolUse のみ。Stop で止めるとエージェントが終われなくなる）。Claude Code は終了コードが 0 / 2 以外のフックを「失敗」として通すため、`hook.sh` が node の有無と `hook.ts` の終了コードを見て PreToolUse だけ 2 に倒す。Claude Code 2.1.295 以降のフック設定 `onFailure: "block"` が将来の置き換え候補。エージェントが動けなくなれば人間がすぐ気付く |
| **改変を可視化する（tamper-evident）** | ハーネスの構成ファイルは CI の `selfcheck` が検査し、CODEOWNERS によりメンテナのレビューが必須。消せば CI が赤くなる |
| **開発を邪魔しない** | 止めるのは「取り返しがつかない」「秘密情報に触れる」「規約を機械的に迂回する」操作だけ。lint / 型 / テストは lefthook と CI の仕事 |
| **理由と代替策を返す** | 拒否メッセージには必ず「なぜ駄目か」と「代わりにどうするか」（AGENTS.md の該当番号）を書く |
| **依存ゼロ** | ハーネスは Node 24 標準機能だけで動く（TypeScript を直接実行）。`npm ci` 前でも、CI でも同じコードが走る |

## 3. 全体像

```
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ 層 1  指示                                                                   │
 │   AGENTS.md（正本） ← CLAUDE.md が @AGENTS.md で取り込む / Codex はそのまま読む   │
 │   SessionStart フック: 「ハーネスが有効」「止まる操作一覧」を冒頭で伝える          │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ 層 2  実行時ガード（ツール呼び出しごと）                                          │
 │   Claude Code: .claude/settings.json  permissions.deny / ask  + hooks          │
 │   Codex      : .codex/config.toml     sandbox + approvals      + hooks, .codex/rules │
 │                      │                                   │                    │
 │                      └────► scripts/agent-harness/hook.sh ◄──────┘            │
 │                                   │  node 24 以上を確認 → hook.ts（入口）          │
 │                                   │  guard.ts（判定） ← policy.ts（ルール）       │
 │                                   │  PreToolUse: Bash / Edit / Write / apply_patch │
 │                                   │  PostToolUse: migrations → check:migrations,   │
 │                                   │               package.json → 依存追加の検出      │
 │                                   └  Stop: 差分の秘密情報 / R9 の最終確認          │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ 層 3  git フック（lefthook）                                                   │
 │   pre-commit: eslint --fix / check:migrations / check:migration-immutability     │
 │   pre-push  : main への直接 push を拒否 / 不変性チェック                          │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ 層 4  CI（.github/workflows/ci.yml）                                           │
 │   Secret Scan（gitleaks, 全履歴）/ Lint & Build Verification / Harness Guard     │
 │   （不変性 + selfcheck）/ Dependency Review（PR で増えた脆弱な依存）              │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │ 層 5  GitHub                                                                  │
 │   ruleset「main protection」（PR 必須・必須チェック・squash のみ）                │
 │   CODEOWNERS（ハーネス・CI・マイグレーション・セキュリティ関連はメンテナ必須）      │
 │   Secret scanning + push protection / Dependabot                              │
 └──────────────────────────────────────────────────────────────────────────────┘
```

## 4. ファイル一覧

| ファイル | 役割 | 保護 |
|---|---|---|
| [`scripts/agent-harness/policy.ts`](../scripts/agent-harness/policy.ts) | **ルールの正本**（拒否するコマンド・保護パス・秘密情報パターン） | ✅ |
| [`scripts/agent-harness/guard.ts`](../scripts/agent-harness/guard.ts) | 判定ロジック（純関数。単体テスト対象） | ✅ |
| [`scripts/agent-harness/hook.sh`](../scripts/agent-harness/hook.sh) | 起動ラッパー（POSIX sh）。設定ファイルの hooks はこれを呼ぶ。node 24 以上を確かめて `hook.ts` を実行し、node が無い・`hook.ts` が落ちたときは PreToolUse だけ拒否（終了コード 2）にする | ✅ |
| [`scripts/agent-harness/hook.ts`](../scripts/agent-harness/hook.ts) | Claude Code / Codex 共通の入口（stdin JSON → 終了コード） | ✅ |
| [`scripts/agent-harness/selfcheck.ts`](../scripts/agent-harness/selfcheck.ts) | 設定ファイルの配線と hook.ts の実動作を検査（`npm run check:harness`。CI の Harness Guard） | ✅ |
| `scripts/agent-harness/__tests__/` | guard.ts の単体テスト（`npm run test` で実行） | ✅ |
| [`scripts/db/check-migration-immutability.ts`](../scripts/db/check-migration-immutability.ts) | R9（既存マイグレーションの不変性）の機械チェック。CI / lefthook / Stop フックが使う | ✅ |
| [`.claude/settings.json`](../.claude/settings.json) | Claude Code: `permissions.deny / ask`、`disableBypassPermissionsMode`、hooks | ✅ |
| [`.codex/config.toml`](../.codex/config.toml) | Codex: `sandbox_mode` / `approval_policy` / `project_doc_max_bytes` / hooks | ✅ |
| [`.codex/rules/opengreentrack.rules`](../.codex/rules/opengreentrack.rules) | Codex: コマンド前方一致の `forbidden` / `prompt` ルール（フックの二重化） | ✅ |
| [`CLAUDE.md`](../CLAUDE.md) | `@AGENTS.md` で規約を確実に読み込ませる | ✅ |
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI（Harness Guard / Dependency Review を含む） | ✅ |
| [`.github/CODEOWNERS`](../.github/CODEOWNERS) | 保護対象の変更にメンテナのレビューを必須にする | ✅ |
| [`.github/dependabot.yml`](../.github/dependabot.yml) | 依存・Actions の更新 PR を自動作成 | ✅ |
| [`lefthook.yml`](../lefthook.yml) | git フック | ✅ |
| `.agent-harness-audit.jsonl` | 拒否した操作の監査ログ（ローカル。`.gitignore` 済み。時刻・エージェント・イベント・ツール名・ルール ID だけを残し、コマンド文字列やパスは残さない） | — |

「保護 ✅」のファイルは **エージェントが書き換えられない**（§7）。

## 5. 止める操作（policy.ts の要約）

拒否メッセージに出るルール ID で引けるようにしています。実体は `policy.ts` を参照してください。

| 分類 | 止める操作（ルール ID） | 根拠 |
|---|---|---|
| git | force push（`git-force-push`。`-fu` のような束も）/ main への直接 push（`git-push-main`。refspec の更新先が main の `feat/x:main`、`--all` / `--mirror`、現在のブランチが main なら引数なしの `git push` も）/ `reset --hard` `clean -f` `checkout .` `restore --source=HEAD .`（`git-destructive-worktree`。オプションの位置は問わない）/ `branch -D` `branch -d -f`（`git-branch-force-delete`）/ `--no-verify` `commit -n` `core.hooksPath` `GIT_CONFIG_*` によるフック迂回（`git-bypass-hooks`, `env-bypass-hooks`）/ `git add -f`（`git-add-force`）/ 履歴書き換え・リモート付け替え・作者偽装・別名定義（`git-alias`）/ `.git/` 配下（フック・設定）への書き込み（`protected-path:git-dir`。読むのは可） | R11, R7 |
| GitHub CLI | `gh pr merge`（`gh-pr-merge`）/ `gh pr review --approve`（`gh-pr-approve`）/ PR を閉じる / リポジトリ設定・secret・ruleset・workflow 実行・`gh auth token`・`gh alias set`（`gh-repo-admin`）/ `gh api` の書き込み系（`gh-api-write`。メソッド名の大文字小文字は問わない）。`gh pr -R owner/repo merge` のように `-R` / `--repo` を挟んでも同じ | R11, OSS 運用 |
| Supabase / DB | `db push` `db pull` `link` `secrets` `projects` `migration repair` 等のリモート操作と、`--linked` かローカル以外の `--db-url` を伴うすべての操作（`supabase-remote`。`npx supabase@latest` / `npm exec supabase` / `node_modules/.bin/supabase` / `--debug` `--workdir` 付きの呼び方でも同じ）/ ローカル以外のホストへの `psql` `pg_dump`（`-h`・接続 URL・`host=` 形式・`PGHOST=`）と seed 投入（`remote-database`） | supabase/README.md |
| 依存 | `npm install <pkg>`（`npm-add-dependency`）/ `-g` / `npm publish` 等 / `npm pkg set`（`npm-pkg-set`）/ pnpm・yarn・bun（`other-package-manager`。`npx pnpm` も）/ package.json 編集による依存追加（PostToolUse と Stop で検出） | §1 |
| 秘密情報 | `.env*`（ファイル名が `.env` で始まるものすべて。`.env.*` `.envrc` `.env?local` も。`.env.example` だけ可）・`e2e/.auth`・`supabase/.temp`・バックアップ・`~/.ssh` `~/.aws` `~/.config/gh` `~/.codex/auth.json`・`/etc/passwd` `/etc/shadow` `/etc/sudoers` `/etc/ssh` などの読み書き（`dotenv`, `home-credentials`, `system-files` …）/ 秘密情報を持つ環境変数の値の参照（`secret-env-reference`。`$NAME` のほか `process.env.NAME` `ENVIRON["NAME"]` jq の `env.NAME` も。`test -n "$NAME"` `[ -z "$NAME" ]` の存在確認は通す）/ `printenv NAME` `declare -p NAME`（`secret-env-readout`）/ `printenv` `env` `env -0` `export -p` `declare -x`（`env-dump`）/ キーチェーン | R7 |
| マイグレーション | 既存ファイルの編集・削除・改名（`migration-immutable`, `migrations-shell-mutation`）/ 不正なファイル名（`migration-filename`）/ 書き込み直後の DML 検出（PostToolUse → `check:migrations`） | R9, R12 |
| 権限昇格・ホスト | `sudo` / `chmod -R` `777` / `chown` / `crontab` `launchctl` `ssh-keygen` `osascript` 等（`host-persistence`）/ Docker ボリューム削除 / `/etc` `/usr` `/bin` `/sbin` `/System` `/Library` への書き込み（`protected-system`。解除変数でも解除されない） | — |
| 流出・実行 | `curl … \| sh`（`pipe-to-shell`）/ base64 デコード実行 / `scp` `nc` `rsync` 等（`file-transfer`）/ ファイルのアップロード（`upload-file`。`curl -T` `-d @file` `--json @file` `wget --post-file=`）/ `eval` | — |
| 包み方・別名 | `bash -c "…"` `sh -lc` `xargs` `if … then` `while … do` `{ …; }` `!` の中のコマンドも取り出して同じルールで判定する（`bash -c` の入れ子は 3 段まで）。`git -C dir …` `gh pr -R owner/repo …` のようにグローバルオプションを挟んだ形も同じ | — |
| ハーネス自身 | §4 の保護 ✅ ファイルと `lefthook-local.yml` `.lefthook/` `.lefthook-local/` `.git/` への書き込み（`protected-path:*`。Bash の `apply_patch` 呼び出しも対象）/ ホーム配下の設定・認証情報への書き込み（`protected-home:*`）/ 解除変数の自己設定（`env-harness-unlock`） | — |
| 作業終了時（Stop） | 作業ツリーの差分に秘密情報らしき値がある / 既存マイグレーションが変わっている / package.json に依存が増えている → 直すまで終了させない | R7, R9, §1 |

**承認を挟む操作（止めはしない）**: `git push`、`gh pr create / comment`、`npm install`（引数なし）、`npx supabase`、`docker`、`curl`、
`node -e` `node -p` などのインラインコード実行、`WebFetch`。Claude Code は `permissions.ask`、Codex は `.codex/rules` の `prompt` で表現しています。

## 6. 止められたときの対処（エージェント・コントリビューター向け）

1. 拒否メッセージの **ルール ID と「代わりにどうするか」** を読む。多くは AGENTS.md の該当番号に正しい手順がある
2. 迂回しない。`bash -c` に包む、`node -e` で書く、別名のコマンドを使う、設定を書き換える、はすべて禁止。
   `bash -c` / `xargs` / `if` に包んでも `git -C` / `gh -R` を挟んでも同じ判定になる。`npm run <script>` / `node x.js` / `bash x.sh` の
   中身は見ないが、それらに止められた操作を逃がすのも同じく禁止（CODEOWNERS と CI が最終的に止める）。
   「止められたが必要だと思う」場合は **作業を止めて人間に相談する**（Issue / PR コメント）
3. 人間が「この操作はこのセッションで必要」と判断した場合だけ、§7 の方法で解除する

## 7. 解除方法（人間向け）

ハーネスの **保護対象パスの書き換えだけ** は、人間がセッション起動時に環境変数を付けることで解除できます。

```bash
OPENGREENTRACK_HARNESS_UNLOCK=1 claude          # Claude Code
OPENGREENTRACK_HARNESS_UNLOCK=1 codex           # Codex CLI
```

- 解除されるのは `protected-path:*` / `protected-home:*` の判定だけ。force push や `db push`、秘密情報の読み書きなどは解除されない
- エージェント自身がこの変数を付けて起動することは `env-harness-unlock` で止める
- SessionStart の案内に「解除されています」と出るので、意図しない解除に気付ける
- ハーネスの変更は必ず PR にし、CODEOWNERS によるメンテナのレビューを受ける（§10）

Claude Code の `permissions.deny` に書いた項目（`.env*` の読み書き、`gh pr merge`、`supabase db push` など）は環境変数では解除されません。
これらは「エージェントが行う正当な理由が無い」操作だけを選んでいます。

## 8. 動作の確認方法

```bash
npm run test                     # guard.ts / check-migration-immutability.ts の単体テスト
npm run check:harness            # 設定ファイルの配線と hook.ts の実動作（CI の Harness Guard と同じ）
npm run check:migration-immutability   # 既存マイグレーションが変わっていないか（CI と同じ）

# フックを手で呼ぶ（Claude Code / Codex が流すのと同じ JSON）
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin x"},"cwd":"'"$PWD"'"}' \
  | sh scripts/agent-harness/hook.sh; echo "exit=$?"       # exit=2 で理由が stderr に出る

# Codex の rules を検証する（Codex CLI または ChatGPT 同梱の codex バイナリ）
codex execpolicy check --pretty --rules .codex/rules/opengreentrack.rules -- gh pr merge 12
```

Claude Code では `/hooks` で読み込まれているフックを、`/permissions` で deny / ask を確認できます。
Codex では `/hooks` でフックを確認して **信頼** する必要があります（フックの内容が変わるたびに再確認）。

## 9. 各エージェントでの前提

### Claude Code

- `.claude/settings.json` の hooks と `permissions.deny` は **リポジトリルートで起動したセッション** にだけ読み込まれる
  （親ディレクトリを遡って探すことはしないため、サブディレクトリで起動すると無効）。`Read(.env.local)` / `Edit(…)` のような
  deny ルールのパスはカレントディレクトリ相対で、ルートで起動すればリポジトリルート相対になる
- 対応環境は **macOS / Linux / WSL** のみ。Git Bash の無い Windows では Claude Code が `Bash` ではなく `PowerShell` ツールを登録するため、
  `Bash` の matcher とフックが一度も動かない（`hook.sh` も POSIX sh と Node 24 以上を前提にしている）
- フックの終了コードが 0 / 2 以外（node 不在・構文エラー・タイムアウト）のときツール実行は通る。`hook.sh` が PreToolUse に限って 2 に倒す。
  Claude Code 2.1.295 以降ならフック設定の `onFailure: "block"` で同じことができる（将来の置き換え候補）
- 対話セッションでは、フォルダを「信頼」するまで hooks は動かない。`claude -p`（非対話）では信頼済み扱いで動く
- `permissions.deny` は user / local 設定の `allow` より常に優先される。`bypassPermissions` モードでも deny は効く
- `disableBypassPermissionsMode: "disable"` により、`--dangerously-skip-permissions` は使えない
- `CLAUDE.md` の `@AGENTS.md` により、規約が必ず文脈に入る（v2.1.277 より前の Claude Code は AGENTS.md を自動では読まない）
- 任意: OS レベルのサンドボックス（`sandbox.enabled`）は既定では有効にしていない。ローカル Supabase（localhost）や Docker と
  干渉する可能性があるため、有効化する場合は各自の `.claude/settings.local.json` で試してから検討する

### Codex（ChatGPT / Codex CLI）

- `.codex/config.toml` と `.codex/rules/` は、プロジェクトを **trusted** にしたときだけ読まれる
- hooks は初回に `/hooks` で内容を確認して信頼する。信頼前はフックが動かない（`sandbox_mode` と `.codex/rules` は動く）
- `sandbox_mode = "workspace-write"`: 作業ツリー内の編集と通常コマンドは承認なし。`.git` / `.codex` / `.agents` は書き込み不可。
  ネットワークは遮断され、`npm install` や `git push` は承認を経てサンドボックスの外で実行される
- `project_doc_max_bytes = 65536`: AGENTS.md が既定の 32 KiB 上限に近く、`next dev` が末尾に追記するブロックで超えうるため
- **個人の `~/.codex/config.toml` で `[projects."/"] trust_level = "trusted"` のようにルートを信頼しないこと。**
  クローンしたあらゆるリポジトリの `.codex/`（rules の `allow` を含む）が読み込まれてしまう。信頼はリポジトリ単位にする

## 10. ハーネス自体を変更するとき（メンテナ向け）

1. `OPENGREENTRACK_HARNESS_UNLOCK=1` でセッションを起動するか、人間が直接編集する
2. ルールは `policy.ts` に足し、`__tests__/guard.test.ts` に「止める例」と「止めない例」の両方を書く
3. `npm run test` / `npm run check:harness` / `npm run lint` / `npm run typecheck` を通す
4. PR を作る。CODEOWNERS によりメンテナのレビューが必須。**レビューでは「検出を消す変更」（deny の削除・allowlist の追加・保護パスの削除）に特に注意する**
5. Codex のフックはコマンド文字列のハッシュで信頼されるため、`hook.sh` の呼び出し方（設定ファイルの `command`）を変えたら各自 `/hooks` で再信頼が必要（`hook.sh` / `hook.ts` の中身の変更は不要）

## 11. GitHub 側で人間が行う設定

ハーネスの層 5 はリポジトリの設定です。コードでは表現できないため、メンテナが GitHub 上（または `gh api`）で設定します。
現状（2026-10-20 時点）と推奨値:

| 項目 | 現状 | 推奨 |
|---|---|---|
| ruleset「main protection」の必須レビュー数 | 0 | **1 以上** |
| ruleset の Code Owner レビュー | 無効 | **有効**（CODEOWNERS を効かせる） |
| ruleset の必須チェック | Secret Scan / Lint & Build Verification | **+ Harness Guard**（Dependency Review は PR のみ走るため push には付けない） |
| ruleset の strict（最新 main を取り込んでから） | 無効 | 有効 |
| ruleset のバイパス | 管理者は常に可 | **PR 経由のみ**（`bypass_mode: pull_request`）か無効 |
| Secret scanning / Push protection | 無効 | **有効**（公開リポジトリは無料。gitleaks と二重化） |
| Dependabot security updates | 無効 | 有効（`dependabot.yml` の更新 PR と併用） |
| Dependency graph | 無効（Dependency Review ジョブが「not supported」で失敗する） | **有効**（Settings → Code security → Dependency graph。Dependency Review と Dependabot の前提） |

> **CODEOWNERS の所有者が 1 人のときの注意**: 現在の CODEOWNERS は所有者が 1 人（`@jgx-KenjiYoshioka`）。この状態で
> 「Code Owner レビュー必須」を有効にすると、所有者自身が出した PR は自分で承認できないためマージできなくなる。
> 有効化の前に第 2 の所有者（メンテナ）を CODEOWNERS に足すか、所有者向けのバイパス方針（`bypass_mode: pull_request`）を決めておく。

```bash
# Secret scanning + push protection + Dependabot security updates を有効化
gh api -X PATCH repos/japan-gx-group/OpenGreenTrack \
  --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"},"dependabot_security_updates":{"status":"enabled"}}}
JSON

# ruleset を更新（必須レビュー 1、Code Owner 必須、Harness Guard を必須チェックに追加、strict）
gh api -X PUT repos/japan-gx-group/OpenGreenTrack/rulesets/22601272 --input - <<'JSON'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request"}],
  "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 1,
      "dismiss_stale_reviews_on_push": true,
      "require_code_owner_review": true,
      "require_last_push_approval": false,
      "required_review_thread_resolution": true,
      "allowed_merge_methods": ["squash"]
    }},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": true,
      "do_not_enforce_on_create": false,
      "required_status_checks": [
        {"context": "Secret Scan"},
        {"context": "Lint & Build Verification"},
        {"context": "Harness Guard"}
      ]
    }}
  ]
}
JSON
```

> これらは外部サービスの設定変更なので、エージェントには実行させません（`gh-repo-admin` / `gh-api-write` で止まります）。

## 12. 既知の限界と残るリスク

| 限界 | 補う層 |
|---|---|
| **任意のスクリプト実行は見ない。** `npm run <script>` / `node x.js` / `bash x.sh` / `npx <パッケージ>` は中身を検査しないため、禁止操作をスクリプトに書いて実行する経路は残る。`node -e` / `python -c` のインラインコードは秘密情報の環境変数参照だけを文字列として見る | Claude: `permissions.ask` で承認を挟む（`node -e` `bash -c` 等）。Codex: rules の `prompt` + サンドボックス（ネットワーク遮断・ワークスペース外書き込み不可）。最終的には CODEOWNERS と CI |
| **Bash 経由の保護パス書き込みの検出はベストエフォート。** `git apply` / `patch` / `tar -x` / `cp -r dir .` / `npx prettier --write` のように引数から書き込み先が読み取れないコマンドでは、保護ファイル（`.claude/` `.github/workflows/` `lefthook.yml` …）を書き換えられる | 実効的な後ろ盾は CODEOWNERS（保護ファイルの変更はレビュー必須）と CI の `selfcheck`（配線が壊れれば赤くなる）。Edit / Write / `apply_patch` ツール経由はパスで確実に止まる |
| ヒアドキュメントの本文は「書き込まれる内容」としてコマンド走査から外す。文字列全体にかけるルール（`pipe-to-shell` `decode-to-shell` `direct-env-file-write`）と秘密情報の環境変数参照だけは本文も見るため、`curl … \| sh` を含む文書を書こうとすると止まる | ファイルは Write / Edit ツールで書く（パスだけで判定される） |
| `bash -c` の入れ子は 3 段まで追う。4 段以上に包んだコマンドは外側の文字列として判定される | Claude: `Bash(bash -c *)` の ask。Codex: rules の `prompt` |
| `.env.local` を `next dev` が読み込む以上、サーバプロセス経由で値を取り出す方法は残る | `secret-env-reference` と `env-dump` で典型経路を止める。実鍵のローテーション手順は SECURITY.md |
| Claude Code のフックは「信頼」するまで動かず、Codex のフックは `/hooks` での信頼が要る。フックが 0 / 2 以外で終了した場合（node 不在・読み込み失敗）は Claude Code がツール実行を通す | `permissions.deny`（Claude）と `sandbox_mode` + rules（Codex）はフック無しでも効く。`hook.sh` が PreToolUse だけ拒否に倒す。CI と GitHub 保護は常に効く |
| 対応環境は macOS / Linux / WSL のみ。Git Bash の無い Windows では Claude Code が `PowerShell` ツールを使うため `Bash` のフックが動かない。設定はリポジトリルートで起動したセッションにだけ読まれる | CI の Harness Guard と ruleset |
| ハーネスはローカルで動くため、クローン直後の別マシンでは hooks の信頼が未了 | CI の Harness Guard と ruleset が最終防衛線 |
| `OPENGREENTRACK_HARNESS_UNLOCK=1` は人間の判断に依存する | SessionStart の案内で可視化。解除しても止まる操作が大半 |
| CODEOWNERS の所有者が 1 人の間は、Code Owner レビュー必須にすると所有者自身の PR をマージできない | 第 2 の所有者を足すか、バイパス方針を決めてから有効化する（§11） |
| 監査ログ（`.agent-harness-audit.jsonl`）はルール ID だけを残し、コマンド文字列やパスは残さない。何を打って止められたかは後から辿れない | 理由はその場でエージェントに返る。必要ならセッションの記録（transcript）を見る |
| Dependency Review は「PR で増えた既知の脆弱性」だけを見る。悪意あるパッケージそのものは検出できない | `npm-add-dependency` / `npm-pkg-set` と Stop フックの検出で依存の追加自体を人間の判断に戻す |

---

変更履歴はコミットログを参照してください。設計に関する議論は Issue でお願いします。
