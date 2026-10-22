// AI エージェント用ハーネスの判定ルール（正本）。
//
// Claude Code（.claude/settings.json）と Codex（.codex/config.toml）は、どちらもツール実行の直前に
// scripts/agent-harness/hook.sh → hook.ts を呼ぶ。hook.ts は guard.ts の純関数で判定し、guard.ts はこのファイルの
// ルールだけを参照する。「何を止めるか」をここ 1 か所に集めることで、エージェントごとに規則がずれるのを防ぐ。
//
//   policy.ts  … ルール（データ）。このファイル
//   guard.ts   … 判定ロジック（純関数。単体テスト対象）
//   hook.ts    … 標準入力の JSON を読み、判定結果を終了コードで返す入口（hook.sh が node の有無を確かめてから呼ぶ）
//
// 根拠は AGENTS.md の番号（R1 など）を reason に書く。reason はエージェントにそのまま返るので、
// 「なぜ駄目か」だけでなく「代わりにどうするか」まで書く。
//
// 方針:
// - ここで止めるのは「取り返しがつかない」「秘密情報に触れる」「規約を機械的に迂回する」操作に限る。
//   コードの品質（lint / 型 / テスト）は lefthook と CI が担うので、ハーネスでは扱わない。
// - FORBIDDEN_COMMANDS の正規表現は && / ; / | で分割した単純コマンド 1 つに対して試す（guard.ts の splitCommandSegments）。
//   `git -C dir push` や `gh pr -R o/r merge` のようにグローバルオプションが挟まる形は、guard.ts がオプションを
//   取り除いた形（`git push …` / `gh pr merge …`）も作って同じルールに通す。
//   `bash -c "…"` / `xargs` / `if … then …` の中身は、guard.ts が取り出して再帰的に判定する。
// - 分割前の文字列全体に対しては FORBIDDEN_COMMAND_WHOLE（パイプの組み合わせ等）だけを試す。
// - 判定は「拒否か通過か」の 2 値。Codex の PreToolUse フックは "ask" を受け付けないため、
//   承認を挟みたい操作は Claude 側 permissions.ask / Codex 側 .codex/rules の prompt で表現する。

export interface CommandRule {
  /** ルール ID（監査ログ・テスト・ドキュメントで参照する） */
  id: string;
  /** 単純コマンド 1 つ（先頭の環境変数代入を除いたもの）に対して試す正規表現 */
  pattern: RegExp;
  /** 拒否理由。エージェントにそのまま返す */
  reason: string;
}

export interface PathRule {
  /** ルール ID */
  id: string;
  /** リポジトリルートからの相対パス（区切りは "/"）、またはホームからの "~/" 付きパスに対して試す正規表現 */
  pattern: RegExp;
  /** 拒否理由 */
  reason: string;
}

/** 人間が明示的にハーネスの保護対象を編集させたいときに 1 を設定する環境変数（保護パスの書き換えだけを解除する） */
export const UNLOCK_ENV = 'OPENGREENTRACK_HARNESS_UNLOCK';

/** 拒否した操作を追記する監査ログ（リポジトリルート直下。.gitignore 済み。ルール ID だけを残し、コマンド文字列は残さない） */
export const AUDIT_LOG_FILE = '.agent-harness-audit.jsonl';

/** 1 を設定すると監査ログを書かない（selfcheck.ts が検査用に呼ぶとき用） */
export const NO_AUDIT_ENV = 'OPENGREENTRACK_HARNESS_NO_AUDIT';

/** R9: 新規マイグレーションのファイル名（`npx supabase migration new <name>` が作る形式） */
export const MIGRATION_FILENAME = /^\d{14}_[a-z0-9_]+\.sql$/;

/** ローカル開発用と見なす DB ホスト（これ以外のホストへの psql / seed 投入は拒否する） */
export const LOCAL_DB_HOSTS: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'host.docker.internal',
  'db',
  'supabase_db',
]);

/** 値が秘密情報である環境変数名の特徴（SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY / GITHUB_TOKEN など） */
const SECRET_ENV_NAME = '\\w*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|SERVICE_ROLE|PRIVATE_KEY)\\w*';

/**
 * シェルコマンド（分割後の単純コマンド）に対する拒否ルール。
 * 先頭の `FOO=bar` 形式の環境変数代入は guard.ts が取り除いてから試す（代入そのものは ENV_ASSIGNMENT_RULES で見る）。
 */
export const FORBIDDEN_COMMANDS: readonly CommandRule[] = [
  // --- git: 履歴・ブランチを壊す操作 ---------------------------------------------------------
  {
    id: 'git-force-push',
    // --force 系の長いオプション / f を含む短いオプションの束（-f -fu -uf）/ 先頭 + の refspec
    pattern: /^git\s+push\b(?=.*\s(?:--force|--force-with-lease|--force-if-includes)\b|.*\s-[a-zA-Z]*f[a-zA-Z]*\b|.*\s\+\S)/,
    reason: 'force push は禁止（main の non_fast_forward 保護と同じ方針）。履歴を直したい場合は新しいコミットを積んで PR にする',
  },
  {
    id: 'git-push-delete',
    pattern: /^git\s+push\b.*\s(?:--delete|-[a-zA-Z]*d[a-zA-Z]*)\b/,
    reason: 'リモートブランチの削除は人間が GitHub 上で行う（マージ後は自動削除される）',
  },
  {
    id: 'git-destructive-worktree',
    // reset は --hard が引数のどの位置にあっても / clean は f を含む短い束か --force がどこにあっても /
    // checkout・restore は "." が引数のどこにあっても（--source=HEAD . のような形を含む）
    pattern:
      /^git\s+(?:reset\b(?=.*\s--hard\b)|clean\b(?=.*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b)|(?:checkout|restore)\b(?=(?:\s+\S+)*\s+\.(?:\s|$)))/,
    reason: '作業ツリーを丸ごと破棄する操作は禁止。戻したいファイルを個別に `git restore <path>` で指定する',
  },
  {
    id: 'git-branch-force-delete',
    // -D（束を含む）か、削除オプション（-d / --delete）と強制オプション（-f / --force）の両方があるとき
    pattern: /^git\s+branch\b(?=.*\s-[a-zA-Z]*D[a-zA-Z]*\b|(?=.*\s(?:-[a-zA-Z]*d[a-zA-Z]*|--delete)\b)(?=.*\s(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b))/,
    reason: 'マージ済みでないブランチの強制削除は禁止（-d なら可）',
  },
  {
    id: 'git-bypass-hooks',
    // --no-verify はどのサブコマンドでも / -c core.hooksPath（大文字小文字を問わない）/ config … core.hooksPath（set 等を挟んでも）/
    // commit の短いオプション -n（--no-verify と同じ。束の中に n があっても。-u<mode> は untracked-files なので除く）
    pattern:
      /^git\s+(?:(?:\S+\s+)*?(?:--no-verify\b|-c\s*core\.hookspath(?:=|\b))|config\s+(?:\S+\s+)*?core\.hookspath\b|commit\b(?=.*\s-(?!u)[a-zA-Z]*n[a-zA-Z]*\b))/i,
    reason: 'git フック（lefthook）の迂回は禁止（AGENTS.md R11）。フックが落ちる原因を直してからコミットする',
  },
  {
    id: 'lefthook-uninstall',
    pattern: /^(?:npx\s+)?lefthook\s+(?:uninstall|disable)\b/,
    reason: 'lefthook の無効化は禁止（AGENTS.md R11）',
  },
  {
    id: 'git-add-force',
    pattern: /^git\s+add\b.*\s(?:-f|--force)\b/,
    reason: '.gitignore で除外されたファイル（.env.local 等）の強制追加は禁止（AGENTS.md R7）',
  },
  {
    id: 'git-history-rewrite',
    pattern: /^git\s+(?:filter-branch|filter-repo|replace)\b/,
    reason: '履歴の書き換えは禁止。秘密情報を消したい場合はキーをローテーションし SECURITY.md の手順で連絡する',
  },
  {
    id: 'git-tag-delete',
    pattern: /^git\s+tag\s+(?:-d|--delete)\b/,
    reason: 'タグの削除は人間が行う',
  },
  {
    id: 'git-remote-rewrite',
    pattern: /^git\s+remote\s+(?:set-url|remove|rm|rename)\b/,
    reason: 'リモートの付け替えは禁止（push 先がすり替わるのを防ぐ）',
  },
  {
    id: 'git-global-config',
    pattern: /^git\s+config\s+(?:\S+\s+)*?(?:--global|--system)\b/,
    reason: 'マシン全体の git 設定は変更しない（必要ならリポジトリローカル設定で、理由を PR に書く）',
  },
  {
    id: 'git-commit-author-override',
    pattern: /^git\s+commit\b.*\s--author\b/,
    reason: 'コミットの作者の偽装は禁止',
  },
  {
    id: 'git-alias',
    pattern: /^git\s+config\s+(?:\S+\s+)*?alias\./,
    reason: 'git の別名定義は禁止（禁止コマンドを別名で呼べるため）',
  },

  // --- GitHub CLI: マージ・承認・リポジトリ設定 --------------------------------------------------
  // `gh pr -R owner/repo merge` のように -R / --repo が挟まる形は guard.ts が取り除いた形でも試す
  {
    id: 'gh-pr-merge',
    pattern: /^gh\s+pr\s+merge\b/,
    reason: 'PR のマージはメンテナが GitHub 上で行う（AGENTS.md R11）。CI とレビューが揃ったことをコメントで知らせる',
  },
  {
    id: 'gh-pr-approve',
    pattern: /^gh\s+pr\s+review\b.*(?:\s--approve\b|\s-a\b)/,
    reason: 'PR の承認は人間のレビュアーが行う。エージェントは承認を付けない（レビュー要件の形骸化を防ぐ）',
  },
  {
    id: 'gh-pr-close',
    pattern: /^gh\s+pr\s+(?:close|lock|unlock)\b/,
    reason: '他人の PR を閉じる・ロックする操作は人間が行う',
  },
  {
    id: 'gh-repo-admin',
    pattern:
      /^gh\s+(?:repo\s+(?:delete|edit|archive|unarchive|rename|set-default|sync|deploy-key)|ruleset|secret|variable|release\s+(?:delete|create|edit|upload)|run\s+(?:delete|cancel|rerun)|workflow\s+(?:disable|enable|run)|auth\s+(?:token|logout|refresh|login|setup-git)|codespace|ssh-key|gpg-key|issue\s+delete|label\s+delete|config\s+set|extension\s+install|alias\s+(?:set|delete|import))\b/,
    reason: 'リポジトリ設定・認証情報・リリース・ワークフロー実行・gh の別名定義の操作は人間が行う',
  },
  {
    id: 'gh-api-write',
    // HTTP メソッド名は大文字小文字を問わない（gh は --method put も受け付ける）
    pattern: /^gh\s+api\b(?=.*(?:\s(?:-X|--method)[=\s]*(?:POST|PUT|PATCH|DELETE)\b|\s(?:-f|-F|--field|--raw-field|--input)\b))/i,
    reason: 'gh api の書き込み系呼び出しは禁止。コメントや Issue は `gh pr comment` / `gh issue create` を使う',
  },

  // --- Supabase: リモート（本番・検証）プロジェクトへの操作 --------------------------------------
  // 代表的な形を正規表現で持つ。`npx supabase@latest` / `npm exec supabase` / `./node_modules/.bin/supabase` や
  // グローバルフラグが挟まる形は、guard.ts の checkSupabaseRemote が SUPABASE_REMOTE_SUBCOMMANDS を使って判定する
  {
    id: 'supabase-remote',
    pattern:
      /^(?:npx\s+(?:--yes\s+|-y\s+)?)?supabase\s+(?:db\s+(?:push|pull|dump\b.*--linked|reset\b.*--linked)|link|unlink|login|logout|projects\s+(?:create|delete|api-keys)|secrets|functions\s+(?:deploy|delete)|migration\s+(?:repair|squash|fetch)|branches|orgs|domains|network-bans|network-restrictions|ssl-enforcement|sso|config\s+push|postgres-config|backups|snippets|encryption|vanity-subdomains)\b/,
    reason:
      'リモートの Supabase プロジェクトへの操作（db push / link / secrets / --linked / ローカル以外の --db-url 等）は人間が supabase/README.md の手順で行う。ローカルは `npx supabase db reset` を使う',
  },

  // --- npm: 依存の追加・公開・別パッケージマネージャ ---------------------------------------------
  {
    id: 'npm-publish',
    pattern: /^npm\s+(?:publish|unpublish|deprecate|owner|token|login|logout|adduser|access|hook|profile|org|team|link|config\s+set|set\s)\b/,
    reason: 'npm レジストリ・認証・グローバル設定の操作は禁止',
  },
  {
    id: 'npm-pkg-set',
    pattern: /^npm\s+pkg\s+set\b/,
    reason: '`npm pkg set` による package.json の書き換えは禁止（依存の追加を検出できないため）。package.json は Edit ツールで編集し、新しいライブラリは追加しない（AGENTS.md §1）',
  },
  {
    id: 'other-package-manager',
    pattern: /^(?:npx\s+(?:-y\s+|--yes\s+)?)?(?:pnpm|yarn|bun|corepack)\b/,
    reason: 'このリポジトリは npm 専用（package-lock.json が正）。pnpm / yarn / bun は使わない',
  },

  // --- 権限昇格・ホスト設定・永続化 ------------------------------------------------------------
  {
    id: 'sudo',
    pattern: /^(?:sudo|doas|su)\b/,
    reason: 'root 権限は不要。必要に見える場合は作業を止めて人間に相談する',
  },
  {
    id: 'chmod-chown',
    // -R / 末尾が 6 か 7（その他のユーザーに書き込み可）の数値モード / o+w a+w、および chown
    pattern: /^(?:chmod\s+(?:-R\b|.*\b[0-7]?[0-7]{2}[67]\b|.*\b[ao]\+w)|chown\b)/,
    reason: '再帰的・全員書き込み可の権限変更と所有者変更は禁止',
  },
  {
    id: 'host-persistence',
    pattern: /^(?:crontab|launchctl|systemctl|ssh-keygen|ssh-add|ssh-copy-id|ssh|defaults\s+write|osascript|shred|history\s+-c)\b/,
    reason: 'ホスト OS の設定変更・鍵操作・自動化は禁止（リポジトリの外に影響する）',
  },
  {
    id: 'docker-destructive',
    pattern: /^docker\s+(?:system\s+prune|volume\s+(?:rm|prune)|container\s+prune|rm\b.*\s-\w*v|compose\s+down\b.*\s(?:-v|--volumes))\b/,
    reason: 'Docker ボリュームの削除（ローカル Supabase の DB を失う）は禁止。作り直しは `npx supabase db reset`',
  },

  // --- 秘密情報の読み出し・流出 ------------------------------------------------------------
  {
    id: 'env-dump',
    // 引数なしの printenv / env / set / export、コマンドを伴わない env（-0 / -i / -u NAME / NAME=value だけ）、
    // export -p / declare -x / declare -p（エクスポート済み変数の一覧）
    pattern:
      /^(?:printenv|env|set|export)\s*$|^env(?:\s+(?:-u\s+\S+|--unset\s+\S+|-\S*|\S+=\S*))+\s*$|^(?:export|declare|typeset)\s+-[a-zA-Z]*[px][a-zA-Z]*\s*$/,
    reason: '環境変数の一覧表示は禁止（秘密情報が混ざる）。必要な変数名だけを `test -n "$NAME"` のように確認する',
  },
  {
    id: 'secret-env-readout',
    // printenv NAME / declare -p NAME で秘密情報を持つ変数の値を表示する形
    pattern: new RegExp(`^(?:printenv\\s+(?:-\\S+\\s+)*|(?:declare|typeset)\\s+-[a-zA-Z]*p[a-zA-Z]*\\s+)${SECRET_ENV_NAME}`, 'i'),
    reason: '秘密情報を持つ環境変数の値の表示は禁止（AGENTS.md R7）。存在確認だけなら `test -n "$NAME"` の形で行う',
  },
  {
    id: 'keychain',
    pattern: /^security\s+find-(?:generic|internet)-password\b/,
    reason: 'macOS キーチェーンの読み出しは禁止',
  },

  // --- マイグレーションの改変（R9） -----------------------------------------------------------
  {
    id: 'migrations-shell-mutation',
    // rm / mv / cp / tee / truncate / git rm / git mv は対象に migrations を含めば拒否。sed / perl は -i（上書き）のときだけ
    pattern:
      /^(?:(?:rm|mv|cp|tee|truncate|git\s+(?:rm|mv))\b.*\bsupabase\/migrations\/|(?:sed|perl)\s+(?:\S+\s+)*-[a-zA-Z]*i\S*\s.*\bsupabase\/migrations\/)/,
    reason:
      '既存マイグレーションの改変・削除・複製は禁止（AGENTS.md R9）。新規作成は `npx supabase migration new <name>` か、Write ツールで `<14桁>_<name>.sql` を作る',
  },

  // --- ネットワーク経由の流出 ------------------------------------------------------------
  {
    id: 'file-transfer',
    pattern: /^(?:scp|sftp|ftp|nc|ncat|netcat|telnet|socat|rsync)\b/,
    reason: 'ファイル転送・生ソケット通信は禁止',
  },
  {
    id: 'upload-file',
    // -T file / --upload-file / -d @file / -F name=@file / --json @file（トークン化でクォートは外れる）/ wget --post-file= --body-file=
    pattern:
      /^(?:curl|wget|http|https|xh)\b.*(?:\s-T\s|--upload-file\b|(?:-d|--data(?:-binary|-raw|-urlencode)?|-F|--form|--json)[=\s]*["']?(?:[\w.-]+=)?@|--(?:post|body)-file[=\s])/,
    reason: 'ファイルの外部アップロードは禁止',
  },
  {
    id: 'eval',
    pattern: /^eval\b/,
    reason: 'eval による動的実行は禁止（検査を迂回できるため）',
  },
];

/**
 * 分割前のコマンド全体（改行を含む文字列）に対して試すルール。
 * パイプで繋いだ組み合わせと、リダイレクトによる .env への書き込みはここで見る（ヒアドキュメントの本文も含めた文字列全体）。
 */
export const FORBIDDEN_COMMAND_WHOLE: readonly CommandRule[] = [
  {
    id: 'pipe-to-shell',
    pattern: /\b(?:curl|wget|fetch)\b[^|\n]*\|\s*(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|fish|python3?|node|perl|ruby)\b/,
    reason: 'ダウンロードした内容をそのままシェルへ渡す実行は禁止（サプライチェーン攻撃の典型経路）',
  },
  {
    id: 'decode-to-shell',
    pattern: /\bbase64\b[^|\n]*\|\s*(?:bash|sh|zsh|node|python3?|perl)\b/,
    reason: 'エンコードされた内容のデコード実行は禁止',
  },
  {
    id: 'direct-env-file-write',
    pattern: /(?:>|>>|tee)\s*["']?(?:\.\/)?(?:supabase\/)?\.env(?!\.example\b)/,
    reason: '.env ファイルへの書き込みは禁止（AGENTS.md R7）。設定値は人間が .env.local に入れる',
  },
];

/**
 * 秘密情報を持つ環境変数の値の参照。単純コマンド 1 つごと（先頭が test / [ / [[ のものは除く）と、
 * ヒアドキュメントの本文（展開されてファイルに書かれる）に対して試す。
 * シェルの $NAME / ${NAME}、jq の env.NAME / $ENV.NAME、node の process.env.NAME、awk の ENVIRON["NAME"]、
 * python の os.environ["NAME"]、perl の $ENV{NAME} / getenv("NAME") を見る。
 */
export const SECRET_ENV_REFERENCE_RULE: CommandRule = {
  id: 'secret-env-reference',
  pattern: new RegExp(
    [
      `\\$\\{?${SECRET_ENV_NAME}\\}?`,
      `\\$ENV(?:\\.|\\{)${SECRET_ENV_NAME}`,
      `(?<![\\w.$])env\\.${SECRET_ENV_NAME}`,
      `\\bprocess\\.env(?:\\.|\\[["']?)${SECRET_ENV_NAME}`,
      `\\bENVIRON\\[["']?${SECRET_ENV_NAME}`,
      `\\bos\\.environ(?:\\.get\\(|\\[)["']?${SECRET_ENV_NAME}`,
      `\\bgetenv\\(["']?${SECRET_ENV_NAME}`,
    ].join('|'),
    'i',
  ),
  reason: '秘密情報を持つ環境変数の値の参照は禁止（AGENTS.md R7）。存在確認だけなら `test -n "$NAME"` の形で行う',
};

/** SECRET_ENV_REFERENCE_RULE を適用しない単純コマンドの先頭語（存在確認 `test -n "$NAME"` / `[ -z "$NAME" ]` のため） */
export const SECRET_REFERENCE_EXEMPT_HEADS: ReadonlySet<string> = new Set(['test', '[', '[[']);

/** `FOO=bar cmd` 形式の環境変数代入のうち拒否するもの */
export const ENV_ASSIGNMENT_RULES: readonly CommandRule[] = [
  {
    id: 'env-bypass-hooks',
    // lefthook / husky の無効化変数と、GIT_CONFIG_* による git 設定の上書き（core.hooksPath を差し替えられる）
    pattern: /^(?:LEFTHOOK=(?:0|false)|LEFTHOOK_EXCLUDE=|HUSKY=0|SKIP_SIMPLE_GIT_HOOKS=|GIT_CONFIG_(?:KEY_\d+|VALUE_\d+|COUNT|PARAMETERS)=)/,
    reason: 'git フックを環境変数で無効化・迂回するのは禁止（AGENTS.md R11）。GIT_CONFIG_* による設定の上書きも同じ扱い',
  },
  {
    id: 'env-remote-e2e',
    pattern: /^E2E_ALLOW_REMOTE_SUPABASE=/,
    reason: 'E2E をリモート Supabase へ向ける指定は人間が行う（活動量データの作成・削除を伴うため）',
  },
  {
    id: 'env-harness-unlock',
    pattern: /^OPENGREENTRACK_HARNESS_UNLOCK=/,
    reason: 'ハーネスの解除変数はエージェントが自分で設定しない（人間がセッション起動時に付ける）',
  },
];

/**
 * 読み取りも書き込みも拒否するパス（コマンド中の語として現れた時点で拒否）。
 * .env 系は .env.example だけを許す。ホームディレクトリ配下の認証情報は "~/" 付きの形でだけ一致させる
 * （リポジトリ内の .claude/settings.json などハーネスの一部は読んでよいため）。
 */
export const SENSITIVE_PATH_PATTERNS: readonly PathRule[] = [
  {
    id: 'dotenv',
    // ファイル名が .env で始まるものすべて（.env.local / .env.* / .env* / .env?local / .envrc …）。.env.example だけは除く。
    // "--env-file=.env.local" のように "=" の直後に現れる形も見る
    pattern: /(?:^|[/=])\.env(?!\.example$)[^/]*$/,
    reason: '.env ファイルは読まない・書かない（AGENTS.md R7）。雛形は .env.example、実値は人間が .env.local に置く',
  },
  {
    id: 'e2e-auth-state',
    pattern: /(?:^|\/)e2e\/\.auth(?:\/|$)/,
    reason: 'E2E のログイン済みセッション（認証 Cookie）は読まない',
  },
  {
    id: 'supabase-temp',
    pattern: /(?:^|\/)supabase\/\.temp(?:\/|$)/,
    reason: 'supabase/.temp は link 済みプロジェクトの参照情報を含むため触らない',
  },
  {
    id: 'db-backup',
    pattern: /(?:^|\/)(?:backup(?:_[\w-]+)?\/|backup_[\w-]+\.sql$|opengreentrack_[\w-]+\.sql$|[\w-]+\.dump$)/,
    reason: 'DB バックアップ（全組織の実データ）は触らない',
  },
  {
    id: 'home-credentials',
    pattern:
      /^~\/(?:\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|\.docker\/config\.json|\.config\/gh|\.codex\/auth\.json|\.codex\/config\.toml|\.claude\/(?:\.credentials\.json|credentials\.json|settings\.json)|Library\/Keychains|\.kube\/config)(?:\/|$)|(?:^|\/)(?:id_rsa|id_ed25519|id_ecdsa)(?:\.pub)?$/,
    reason: '認証情報・個人設定（~/.ssh, ~/.aws, gh / codex / claude の資格情報）は触らない',
  },
  {
    id: 'system-files',
    // 読むだけでも拒否するのはアカウント・認証に関わるファイルだけ（/etc/hosts や /usr/bin/env は通す）。
    // システム領域への書き込みは PROTECTED_SYSTEM_PATHS で別に止める
    pattern: /^\/(?:private\/)?etc\/(?:passwd|shadow|master\.passwd|sudoers(?:\.d)?|ssh)(?:\/|$)/,
    reason: 'OS のアカウント・認証情報（/etc/passwd /etc/shadow /etc/sudoers /etc/ssh）は触らない',
  },
  {
    id: 'pem-keys',
    pattern: /\.(?:pem|p12|pfx|key)$/,
    reason: '秘密鍵ファイルは触らない',
  },
];

/**
 * .env 系のパスを含んでいても許可する定型コマンド（セットアップ手順そのもの）。
 * 先頭のシェルキーワード（if 等）と環境変数代入を取り除いた形に対して試す
 */
export const SENSITIVE_PATH_ALLOWED_COMMANDS: readonly RegExp[] = [
  /^cp\s+(?:-n\s+)?\.env\.example\s+\.env(?:\.local)?\s*$/,
  /^(?:(?:ls|test|stat|wc|file|du|git\s+check-ignore|git\s+status|git\s+ls-files)\b|\[\[?\s)/,
];

/**
 * エージェントが書き換えてはいけないパス（ハーネス自身と、それを支える設定）。
 * 変更は人間が PR で行う（CODEOWNERS でレビュー必須）。UNLOCK_ENV=1 のセッションだけ解除される。
 */
export const PROTECTED_PATHS: readonly PathRule[] = [
  { id: 'harness-claude', pattern: /^\.claude\//, reason: 'Claude Code の設定（権限・フック）はハーネスの一部' },
  { id: 'harness-codex', pattern: /^\.codex\//, reason: 'Codex の設定（サンドボックス・フック・rules）はハーネスの一部' },
  { id: 'harness-scripts', pattern: /^scripts\/agent-harness\//, reason: 'ハーネス本体' },
  { id: 'harness-db-checks', pattern: /^scripts\/db\/check-migration/, reason: 'マイグレーション検査（R9 / R12 の機械チェック）' },
  { id: 'ci-workflows', pattern: /^\.github\/(?:workflows\/|CODEOWNERS$|dependabot\.yml$)/, reason: 'CI・レビュー必須経路・依存更新の設定' },
  {
    id: 'git-hooks',
    // lefthook の設定（yml / yaml / toml / json と -local 版）、スクリプト置き場（.lefthook/ .lefthook-local/）
    pattern: /^\.?lefthook(?:-local)?(?:\.(?:ya?ml|toml|json)$|\/)/,
    reason: 'git フック定義（lefthook-local や .lefthook/ でフックを差し替えられる）',
  },
  { id: 'git-dir', pattern: /^\.git\//, reason: '.git 配下（フック・設定・参照）は git コマンド経由でだけ変える' },
  { id: 'secret-scan', pattern: /^\.gitleaks\.toml$/, reason: '秘密情報スキャンの設定（allowlist を増やせば検出を消せる）' },
  { id: 'gitignore', pattern: /^\.gitignore$/, reason: '.env や backup の除外設定' },
  { id: 'agent-instructions', pattern: /^(?:AGENTS(?:\.override)?\.md|CLAUDE\.md)$/, reason: 'エージェントへの指示書（書き換えると以後の挙動が変わる）' },
  { id: 'lockfile', pattern: /^package-lock\.json$/, reason: 'ロックファイルは npm が生成する（手で編集しない）' },
];

/**
 * エージェントの書き込み先として拒否するリポジトリ外のパス（ホーム直下の設定・認証情報。"~/" 付きで試す）。
 * ~/.claude は丸ごとではなく「設定・フック・資格情報」だけを対象にする。Claude Code の自動メモリ
 * （~/.claude/projects/<project>/memory/）はエージェントが正当に書く場所のため
 */
export const PROTECTED_HOME_PATHS: readonly PathRule[] = [
  {
    id: 'home-dotfiles',
    pattern:
      /^~\/(?:\.ssh|\.aws|\.gnupg|\.config|\.codex|\.gitconfig|\.zshrc|\.zprofile|\.zshenv|\.bashrc|\.bash_profile|\.profile|\.npmrc|\.netrc|Library\/LaunchAgents|Library\/Application Support)(?:\/|$)/,
    reason: 'ホームディレクトリ配下の設定・認証情報・エージェント自身の設定には書き込まない',
  },
  {
    id: 'home-claude-config',
    pattern: /^~\/\.claude\/(?:settings(?:\.local)?\.json|keybindings\.json|CLAUDE\.md|\.credentials\.json|credentials\.json|(?:hooks|plugins|skills|commands|agents)\/)/,
    reason: 'Claude Code のユーザー設定・フック・資格情報には書き込まない（自動メモリの書き込みは可）',
  },
];

/** システム領域（絶対パス）。書き込みは UNLOCK_ENV に関わらず拒否する。読むのは system-files に該当しない限り可 */
export const PROTECTED_SYSTEM_PATHS: PathRule = {
  id: 'protected-system',
  pattern: /^\/(?:etc|usr|bin|sbin|System|Library|private\/etc)(?:\/|$)/,
  reason: 'システム領域（/etc /usr /bin /sbin /System /Library）には書き込まない。ツールはリポジトリ内の node_modules か npx で使う',
};

/**
 * リポジトリ外でも書き込みを許すホーム配下のパス（"~/" 付きで試す）。
 * Claude Code の自動メモリはエージェントが正当に書く場所。それ以外のリポジトリ外への書き込みは一時ディレクトリだけ
 */
export const ALLOWED_HOME_WRITE_PATHS: readonly RegExp[] = [/^~\/\.claude\/projects\/[^/]+\/memory\//];

/** Bash 経由の書き込みと見なすコマンド名（保護パスと組み合わさったとき拒否する） */
export const WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'rm', 'mv', 'cp', 'tee', 'truncate', 'ln', 'chmod', 'chown', 'install', 'dd', 'rsync', 'touch', 'mkdir',
  'sed', 'perl', 'patch', 'unzip', 'tar', 'git',
]);

/**
 * 書き込み先が「最後の引数」だけのコマンド（元ファイル側に保護パスがあっても読むだけなので拒否しない）。
 * mv は元ファイルが消える（保護ファイルを退かせる）ため含めない。ln はリンク先（最後の引数）だけが作られる
 */
export const COPY_LIKE_COMMANDS: ReadonlySet<string> = new Set(['cp', 'rsync', 'install', 'ln']);

/** 単純コマンドの先頭から取り除くシェルの予約語・構文要素（`if git push …` / `{ git push …; }` / `! cmd` の形） */
export const SHELL_KEYWORDS: ReadonlySet<string> = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);

/** `-c` を含むオプションで文字列をスクリプトとして実行するシェル（中身を取り出して再帰的に判定する） */
export const SHELL_INTERPRETERS: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/** `bash -c` の入れ子を追う深さの上限（それより深い入れ子は外側の文字列のまま判定する） */
export const MAX_SHELL_DEPTH = 3;

/**
 * リモート（link 済み / 本番）プロジェクトに作用する supabase CLI のサブコマンド（先頭 1 語か 2 語）。
 * これに加えて、--linked か ローカル以外の --db-url を伴う呼び出しはサブコマンドを問わず拒否する
 */
export const SUPABASE_REMOTE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'db push', 'db pull',
  'migration repair', 'migration squash', 'migration fetch',
  'link', 'unlink', 'login', 'logout', 'projects', 'secrets', 'functions deploy', 'functions delete',
  'branches', 'orgs', 'domains', 'network-bans', 'network-restrictions', 'ssl-enforcement', 'sso',
  'config push', 'postgres-config', 'backups', 'snippets', 'encryption', 'vanity-subdomains',
]);

/** コミット前に作業ツリーの差分から検出する秘密情報のパターン（gitleaks がローカルに無い環境向けの簡易版） */
export interface SecretPattern {
  id: string;
  pattern: RegExp;
  label: string;
}

export const SECRET_VALUE_PATTERNS: readonly SecretPattern[] = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, label: '秘密鍵ブロック' },
  {
    id: 'supabase-service-role-jwt',
    // JWT のペイロード（base64url）に "service_role" が含まれるもの。文字列の位置で符号化が 3 通りに変わる
    pattern: /eyJ[\w-]{10,}\.eyJ[\w-]*(?:c2VydmljZV9yb2xl|NlcnZpY2Vfcm9sZ|ZXJ2aWNlX3JvbGU)[\w-]*\.[\w-]{10,}/,
    label: 'Supabase service_role JWT',
  },
  { id: 'supabase-secret-key', pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/, label: 'Supabase secret key' },
  { id: 'supabase-access-token', pattern: /\bsbp_[a-f0-9]{40}\b/, label: 'Supabase personal access token' },
  { id: 'resend-api-key', pattern: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/, label: 'Resend API key' },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/, label: 'GitHub token' },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/, label: 'npm access token' },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, label: 'AWS access key' },
  { id: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/, label: 'OpenAI API key' },
  { id: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/, label: 'Anthropic API key' },
  { id: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, label: 'Slack token' },
  { id: 'postgres-url-with-password', pattern: /postgres(?:ql)?:\/\/[^\s:/@]+:[^\s@]{8,}@(?!localhost|127\.0\.0\.1|host\.docker\.internal|db\b)[^\s/]+/i, label: 'パスワード付きの DB 接続文字列（ローカル以外）' },
];

/**
 * 秘密情報パターンに一致しても許す値（CI のビルド用ダミー値など。.gitleaks.toml と同じ値を書く）。
 * 行全体ではなく一致した値に対して試す（同じ行にダミー値と本物が並んでいても本物は検出する）
 */
export const SECRET_VALUE_ALLOWLIST: readonly RegExp[] = [
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.dummy-anon-key/,
  /your-service-role-key|your-anon-key|re_xxxxxxxxxxxxxxxx/,
];

/** Stop フックの秘密情報スキャンから除外するパス（バイナリ・生成物・ロックファイル） */
export const SECRET_SCAN_SKIP_PATHS: readonly RegExp[] = [
  /^package-lock\.json$/,
  /^public\//,
  /\.(?:png|jpg|jpeg|gif|webp|ico|svg|woff2?|ttf|xlsx|xlsm|pdf|zip|gz|dump)$/i,
];

/** seed / psql の接続先ホストを取り出すために見るオプション */
export const DB_HOST_FLAGS: ReadonlySet<string> = new Set(['-h', '--host', '--db-url', '--dbname', '-d']);
