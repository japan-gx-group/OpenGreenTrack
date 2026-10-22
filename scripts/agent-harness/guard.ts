// AI エージェント用ハーネスの判定ロジック（純関数）。
//
// hook.ts が標準入力から受け取ったツール呼び出しを、policy.ts のルールに照らして「拒否する理由の一覧」に変換する。
// ファイルシステム・git・ネットワークには触れない（それらは hook.ts が引数で渡す）。単体テストは __tests__/guard.test.ts。
//
// 判定の考え方:
//   - シェルコマンドは && / || / ; / | / 改行 / サブシェルで「単純コマンド」に分割し、1 つずつルールに通す。
//     ヒアドキュメントの本文（<<EOF … EOF）は「書き込まれる内容」であってコマンドではないので分割の対象から外す
//     （秘密情報を持つ環境変数の参照だけは、展開されてファイルに書かれるため本文も見る）。
//     先頭のシェル予約語（if / then / { / ! …）と xargs は取り除き、`bash -c "…"` の中身は取り出して再帰的に判定する。
//     `git -C dir push` / `gh pr -R o/r merge` はグローバルオプションを取り除いた形も作って同じルールに通す。
//     分割の精度は完璧ではない（複雑なクォートは崩れる）ので、分割前の文字列全体にも別のルール
//     （FORBIDDEN_COMMAND_WHOLE）を通して二重に見る。
//   - 「拒否」はすべての理由を集めて返す（最初の 1 件で止めない）。エージェントが 1 回で直せるようにするため。
//   - ここで通過しても、Claude Code の permissions / Codex のサンドボックスと承認は別途かかる。
//     ハーネスは「最後の砦」ではなく「最初の網」。

import {
  ALLOWED_HOME_WRITE_PATHS,
  COPY_LIKE_COMMANDS,
  DB_HOST_FLAGS,
  ENV_ASSIGNMENT_RULES,
  FORBIDDEN_COMMANDS,
  FORBIDDEN_COMMAND_WHOLE,
  LOCAL_DB_HOSTS,
  MAX_SHELL_DEPTH,
  MIGRATION_FILENAME,
  PROTECTED_HOME_PATHS,
  PROTECTED_PATHS,
  PROTECTED_SYSTEM_PATHS,
  SECRET_ENV_REFERENCE_RULE,
  SECRET_REFERENCE_EXEMPT_HEADS,
  SECRET_SCAN_SKIP_PATHS,
  SECRET_VALUE_ALLOWLIST,
  SECRET_VALUE_PATTERNS,
  SENSITIVE_PATH_ALLOWED_COMMANDS,
  SENSITIVE_PATH_PATTERNS,
  SHELL_INTERPRETERS,
  SHELL_KEYWORDS,
  SUPABASE_REMOTE_SUBCOMMANDS,
  WRITE_COMMANDS,
} from './policy.ts';

export interface DenyReason {
  /** policy.ts のルール ID */
  id: string;
  /** 拒否理由（エージェントに返す） */
  reason: string;
  /** 一致した箇所（単純コマンドやパス） */
  detail: string;
}

export interface Decision {
  allowed: boolean;
  reasons: DenyReason[];
}

export interface BashContext {
  /** リポジトリルート（絶対パス） */
  repoRoot: string;
  /** コマンドの実行ディレクトリ（絶対パス） */
  cwd: string;
  /** ホームディレクトリ（絶対パス） */
  homeDir: string;
  /** 現在のブランチ名（取得できなければ null） */
  currentBranch: string | null;
  /** OPENGREENTRACK_HARNESS_UNLOCK=1 のセッションか（保護パスの書き換えだけを解除する） */
  unlocked: boolean;
  /** 一時ディレクトリ（ここへの書き込みはリポジトリ外でも許す） */
  tmpDirs: readonly string[];
}

export interface FileContext {
  repoRoot: string;
  cwd: string;
  homeDir: string;
  unlocked: boolean;
  tmpDirs: readonly string[];
  /** そのパスが比較基準（origin/main など）に存在するか。R9 の判定に使う */
  existsInBase: (repoRelativePath: string) => boolean;
}

const allow = (): Decision => ({ allowed: true, reasons: [] });
const decide = (reasons: DenyReason[]): Decision => ({ allowed: reasons.length === 0, reasons });

// ---------------------------------------------------------------------------------------------
// パスの正規化
// ---------------------------------------------------------------------------------------------

const stripQuotes = (token: string): string => token.replace(/^["']|["']$/g, '');

/** `~` と `$HOME` をホームディレクトリに展開する */
export const expandHome = (p: string, homeDir: string): string =>
  p.replace(/^~(?=\/|$)/, homeDir).replace(/^\$\{?HOME\}?(?=\/|$)/, homeDir);

/** POSIX 風に "." / ".." を畳む（path.resolve を使わないのは、テストで OS の cwd に依存させないため） */
export const resolvePath = (base: string, p: string): string => {
  const joined = p.startsWith('/') ? p : `${base}/${p}`;
  const out: string[] = [];
  for (const part of joined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return `/${out.join('/')}`;
};

const isUnder = (p: string, dir: string): boolean => p === dir || p.startsWith(`${dir.replace(/\/$/, '')}/`);

/** 絶対パスをリポジトリルートからの相対パスにする。外なら null */
export const toRepoRelative = (abs: string, repoRoot: string): string | null => {
  if (abs === repoRoot) return '';
  const prefix = `${repoRoot.replace(/\/$/, '')}/`;
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : null;
};

/** 絶対パスをホームからの相対パス（"~/" 付き）にする。外なら null */
const toHomeView = (abs: string, homeDir: string): string | null => {
  const rel = toRepoRelative(abs, homeDir);
  return rel === null ? null : `~/${rel}`;
};

/** コマンド中の語がパスらしいか（オプションやサブコマンド名を除く） */
const looksLikePath = (token: string): boolean =>
  token.length > 0 && !token.startsWith('-') && /[/~.]|^\$\{?HOME/.test(token);

/** `--flag=value` の value 側を取り出す（パス判定のため） */
const valueOfFlag = (token: string): string | null => {
  const m = /^--?[\w-]+=(.+)$/.exec(token);
  return m ? m[1] : null;
};

// ---------------------------------------------------------------------------------------------
// シェルコマンドの分割・字句解析
// ---------------------------------------------------------------------------------------------

/** ヒアドキュメント: 1 = 開始行（`cat > file <<'EOF'`）、2 = 終端語のクォート、3 = 終端語、4 = 本文 */
const HEREDOC = /(<<-?\s*(['"]?)([A-Za-z_][\w-]*)\2[^\n]*)\n([\s\S]*?)\n[ \t]*\3[ \t]*(?=\n|$)/g;

/**
 * ヒアドキュメントの本文を取り除く（`cat > file <<'EOF' … EOF` の … の部分）。
 * 本文は「ファイルに書かれる内容」であり実行されるコマンドではないため、単純コマンドの判定からは外す。
 * 書き込み先（`> file`）の判定は残る 1 行目で行い、文字列全体のルールは呼び出し側が別途かける。
 * 終端が見つからない（壊れた）ヒアドキュメントはそのまま残し、本文も保守的にコマンドとして見る。
 */
export const stripHeredocBodies = (command: string): string => command.replace(HEREDOC, '$1');

/** ヒアドキュメントの本文だけを列挙する（展開されて書き込まれる内容として秘密情報の参照を見るため） */
export const heredocBodies = (command: string): string[] => [...command.matchAll(HEREDOC)].map((m) => m[4]);

/**
 * コマンド文字列を単純コマンドに分割する。
 * 区切り: && || ; | & 改行、$( … )、バッククォート、( … )。
 */
export const splitCommandSegments = (command: string): string[] => {
  const normalized = stripHeredocBodies(command)
    .replace(/\\\r?\n/g, ' ') // 行継続
    .replace(/\$\(|`|\(|\)/g, '\n')
    .replace(/\|\|/g, '\n')
    .replace(/&&/g, '\n')
    .replace(/\|&?/g, '\n')
    .replace(/;/g, '\n')
    .replace(/(?<![<>\d])&(?![<>])/g, '\n'); // 2>&1 の & は区切りにしない
  return normalized
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

/** クォートを考慮した簡易トークナイザ（シェルの完全な実装ではない） */
export const tokenize = (segment: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        current += segment[i + 1];
        i += 1;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasContent = true;
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      current += segment[i + 1];
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0 || hasContent) tokens.push(current);
      current = '';
      hasContent = false;
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || hasContent) tokens.push(current);
  return tokens;
};

const WRAPPER_COMMANDS: ReadonlySet<string> = new Set(['command', 'exec', 'nohup', 'time', 'builtin']);

/** timeout / nice のうち値を取るオプション */
const TIMEOUT_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(['-s', '--signal', '-k', '--kill-after', '-n', '--adjustment']);

/** xargs のうち値を取るオプション（`-I{}` のように値が繋がった形は 1 語として扱う） */
const XARGS_FLAGS_WITH_VALUE = /^-[InPLsdEa]$/;
const XARGS_LONG_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(['--max-args', '--max-procs', '--max-lines', '--max-chars', '--delimiter', '--arg-file', '--eof']);

const isAssignment = (token: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);

/**
 * 先頭の環境変数代入と、シェル予約語 / xargs / timeout / nohup などのラッパーを取り除く。
 * `env` はコマンドを伴うときだけラッパーとして剥がす（`env` / `env -0` 単体は環境変数の一覧表示なので残す）
 */
export const stripPrefixes = (tokens: string[]): { assignments: string[]; tokens: string[] } => {
  const assignments: string[] = [];
  let rest = [...tokens];
  for (;;) {
    while (rest.length > 0 && isAssignment(rest[0])) {
      assignments.push(rest.shift() as string);
    }
    if (rest.length === 0) break;
    const head = rest[0];
    if (SHELL_KEYWORDS.has(head)) {
      rest.shift();
      continue;
    }
    if (head === 'env') {
      const after = rest.slice(1);
      const assigns: string[] = [];
      while (after.length > 0 && (after[0].startsWith('-') || isAssignment(after[0]))) {
        const t = after.shift() as string;
        if ((t === '-u' || t === '--unset') && after.length > 0) after.shift();
        else if (isAssignment(t)) assigns.push(t);
      }
      if (after.length === 0) break;
      assignments.push(...assigns);
      rest = after;
      continue;
    }
    if (head === 'timeout' || head === 'nice') {
      rest.shift();
      while (rest.length > 0 && (rest[0].startsWith('-') || /^\d+(?:\.\d+)?[smhd]?$/.test(rest[0]))) {
        const flag = rest.shift() as string;
        if (TIMEOUT_FLAGS_WITH_VALUE.has(flag) && rest.length > 0) rest.shift();
      }
      continue;
    }
    if (head === 'xargs') {
      rest.shift();
      while (rest.length > 0 && rest[0].startsWith('-')) {
        const flag = rest.shift() as string;
        if ((XARGS_FLAGS_WITH_VALUE.test(flag) || XARGS_LONG_FLAGS_WITH_VALUE.has(flag)) && rest.length > 0) rest.shift();
      }
      continue;
    }
    if (WRAPPER_COMMANDS.has(head)) {
      rest.shift();
      continue;
    }
    break;
  }
  return { assignments, tokens: rest };
};

/** bash / sh のうち値を取るオプション */
const SHELL_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);

/**
 * `bash -c "…"` / `sh -lc "…"` / `npx -c "…"` / `npm exec -c "…"` の実行内容（スクリプト文字列）を取り出す。
 * -c を含む短いオプションの束（-lc / -ec / -ic）も見る。該当しなければ null（`bash scripts/run.sh` は対象外）
 */
export const innerShellScript = (tokens: string[]): string | null => {
  const head = tokens[0] ?? '';
  let i = 1;
  if (head === 'npx' || (head === 'npm' && (tokens[1] === 'exec' || tokens[1] === 'x'))) {
    i = head === 'npm' ? 2 : 1;
    for (; i < tokens.length; i += 1) {
      if (tokens[i] === '-c' || tokens[i] === '--call') return tokens[i + 1] ?? null;
      if (tokens[i].startsWith('--call=')) return tokens[i].slice('--call='.length);
      if (!tokens[i].startsWith('-')) return null;
    }
    return null;
  }
  if (!SHELL_INTERPRETERS.has(head)) return null;
  let hasCommandFlag = false;
  for (; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === '--') {
      i += 1;
      break;
    }
    if (!t.startsWith('-') && !t.startsWith('+')) break;
    if (SHELL_FLAGS_WITH_VALUE.has(t)) {
      i += 1;
      continue;
    }
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)) hasCommandFlag = true;
  }
  if (!hasCommandFlag || i >= tokens.length) return null;
  return tokens[i];
};

/** `git -C dir -c k=v push …` のようなグローバルオプションを飛ばしてサブコマンド位置を返す */
const gitSubcommandIndex = (tokens: string[]): number => {
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '-C' || t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace' || t === '--exec-path') {
      i += 2;
      continue;
    }
    if (t.startsWith('-')) {
      i += 1;
      continue;
    }
    return i;
  }
  return -1;
};

/** `gh pr -R owner/repo merge` の -R / --repo を取り除く */
const stripGhRepoFlags = (tokens: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t === '-R' || t === '--repo') {
      i += 1;
      continue;
    }
    if (t.startsWith('--repo=')) continue;
    out.push(t);
  }
  return out;
};

/**
 * FORBIDDEN_COMMANDS に通す形の一覧。元の語列に加えて、git / gh のグローバルオプションを取り除いた形
 * （`git -C . push --force` → `git push --force`、`gh pr -R o/r merge` → `gh pr merge`）を返す
 */
export const commandVariants = (tokens: string[]): string[][] => {
  const variants = [tokens];
  if (tokens[0] === 'git') {
    const sub = gitSubcommandIndex(tokens);
    if (sub > 1) variants.push(['git', ...tokens.slice(sub)]);
  }
  if (tokens[0] === 'gh') {
    const stripped = stripGhRepoFlags(tokens);
    if (stripped.length !== tokens.length) variants.push(stripped);
  }
  return variants;
};

// ---------------------------------------------------------------------------------------------
// 個別の判定
// ---------------------------------------------------------------------------------------------

/** refspec（`src:dst` / `+src:dst` / `dst`）の更新先を取り出す */
const refspecDestination = (refspec: string): string => {
  const s = refspec.replace(/^\+/, '');
  const colon = s.indexOf(':');
  return colon >= 0 ? s.slice(colon + 1) : s;
};

const isMainDestination = (refspec: string): boolean => {
  const dst = refspecDestination(refspec);
  return dst === 'main' || dst === 'refs/heads/main';
};

/** `git push` が main を直接更新しようとしていないか */
const checkGitPushToMain = (tokens: string[], ctx: BashContext): DenyReason | null => {
  if (tokens[0] !== 'git') return null;
  const sub = gitSubcommandIndex(tokens);
  if (sub < 0 || tokens[sub] !== 'push') return null;
  const args = tokens.slice(sub + 1);
  if (args.includes('--dry-run') || args.includes('-n')) return null;
  const deny = (why: string): DenyReason => ({
    id: 'git-push-main',
    reason: `main への直接 push は禁止（AGENTS.md R11 / CONTRIBUTING.md）。${why}トピックブランチへ push して PR を作る`,
    detail: tokens.join(' '),
  });
  if (args.some((a) => a === '--all' || a === '--branches' || a === '--mirror')) {
    return deny('--all / --branches / --mirror は main を含む全ブランチを push する。');
  }
  const positional = args.filter((a) => !a.startsWith('-'));
  const refspecs = positional.slice(1); // 先頭はリモート名
  const pushesMain =
    refspecs.some(isMainDestination) ||
    (positional.length === 1 && isMainDestination(positional[0])) ||
    (refspecs.length === 0 && ctx.currentBranch === 'main') ||
    (refspecs.length === 1 && refspecs[0] === 'HEAD' && ctx.currentBranch === 'main');
  return pushesMain ? deny('refspec の更新先が main でも同じ。') : null;
};

const NPM_INSTALL_ALIASES: ReadonlySet<string> = new Set(['install', 'i', 'add', 'in', 'ins', 'inst', 'isntall', 'isntal', 'install-test', 'it']);

/** `npm install <package>` による依存の追加（R1）とグローバルインストール */
const checkNpmAddDependency = (tokens: string[]): DenyReason | null => {
  if (tokens[0] !== 'npm' || !NPM_INSTALL_ALIASES.has(tokens[1] ?? '')) return null;
  const args = tokens.slice(2);
  if (args.some((a) => a === '-g' || a === '--global')) {
    return { id: 'npm-global-install', reason: 'グローバルインストールは禁止（`npx <pkg>` で都度実行する）', detail: tokens.join(' ') };
  }
  const packages = args.filter((a) => !a.startsWith('-'));
  if (packages.length === 0) return null;
  return {
    id: 'npm-add-dependency',
    reason:
      '新しいライブラリの追加は禁止（AGENTS.md §1）。実装せず、必要な理由を Issue / PR コメントで提案して人間が追加する。既存依存の再インストールは引数なしの `npm install` か `npm ci`',
    detail: tokens.join(' '),
  };
};

const DANGEROUS_RM_TARGETS: ReadonlySet<string> = new Set(['/', '/*', '~', '~/', '~/*', '$HOME', '${HOME}', '$HOME/*', '.', './', './*', '..', '../', '../*', '*', '.git', '.git/', './.git']);
const PROTECTED_RM_DIRS = /^(?:\.git|src|supabase|supabase\/migrations|supabase\/seeds|scripts|docs|e2e|public|\.github)(?:\/|$)/;

/** 再帰的 rm の対象が致命的でないか */
const checkRecursiveRm = (tokens: string[], effectiveCwd: string, ctx: BashContext): DenyReason | null => {
  if (tokens[0] !== 'rm') return null;
  const flags = tokens.slice(1).filter((t) => t.startsWith('-'));
  const recursive = flags.some((f) => f === '--recursive' || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)));
  if (!recursive) return null;
  const targets = tokens.slice(1).filter((t) => !t.startsWith('-') || t === '-');
  for (const raw of targets) {
    const target = stripQuotes(raw);
    if (DANGEROUS_RM_TARGETS.has(target)) {
      return { id: 'rm-dangerous-target', reason: `再帰削除の対象 "${target}" は禁止`, detail: tokens.join(' ') };
    }
    const abs = resolvePath(effectiveCwd, expandHome(target, ctx.homeDir));
    const rel = toRepoRelative(abs, ctx.repoRoot);
    if (rel === null) {
      if (ctx.tmpDirs.some((d) => isUnder(abs, d))) continue;
      return { id: 'rm-outside-repo', reason: `リポジトリ外（${abs}）の再帰削除は禁止`, detail: tokens.join(' ') };
    }
    if (rel === '' || PROTECTED_RM_DIRS.test(rel)) {
      return { id: 'rm-repo-dir', reason: `"${rel || '.'}" の再帰削除は禁止（node_modules / .next / dist などの生成物だけ削除できる）`, detail: tokens.join(' ') };
    }
  }
  return null;
};

/** URL / -h オプションから DB ホストを取り出す */
export const extractDbHosts = (tokens: string[]): string[] => {
  const hosts: string[] = [];
  const fromUrl = (value: string): void => {
    const m = /^postgres(?:ql)?:\/\/(?:[^@/\s]*@)?(\[[^\]]+\]|[^:/?\s]+)/i.exec(stripQuotes(value));
    if (m) hosts.push(m[1]);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    fromUrl(t);
    const conninfo = /(?:^|\s)host=(\S+)/.exec(stripQuotes(t)); // psql "host=… user=…" 形式
    if (conninfo) hosts.push(conninfo[1]);
    const eq = valueOfFlag(t);
    if (eq !== null) {
      const flag = t.slice(0, t.indexOf('='));
      if (DB_HOST_FLAGS.has(flag)) {
        fromUrl(eq);
        if (!/^postgres/i.test(eq)) hosts.push(stripQuotes(eq));
      }
      continue;
    }
    if (DB_HOST_FLAGS.has(t) && i + 1 < tokens.length) {
      const v = tokens[i + 1];
      if (/^postgres/i.test(stripQuotes(v))) fromUrl(v);
      else if (t === '-h' || t === '--host') hosts.push(stripQuotes(v));
      continue;
    }
    const m = /^-h(.+)$/.exec(t);
    if (m) hosts.push(m[1]);
  }
  return hosts;
};

export const isLocalDbHost = (host: string): boolean => {
  const h = host.toLowerCase();
  return LOCAL_DB_HOSTS.has(h) || h.startsWith('supabase_db_') || h.endsWith('.localhost');
};

const DB_CLIENTS: ReadonlySet<string> = new Set(['psql', 'pg_dump', 'pg_restore', 'pg_dumpall', 'pgcli', 'pgbench']);

const remoteDatabaseReason = (hosts: string[]): string =>
  `ローカル以外の DB（${hosts.join(', ')}）への接続は禁止。本番・検証環境への適用は人間が supabase/README.md の手順で行う`;

/** psql / pg_dump / seed スクリプトの接続先がローカル以外でないか */
const checkRemoteDatabase = (tokens: string[]): DenyReason | null => {
  const isDbClient = DB_CLIENTS.has(tokens[0]);
  const isSeedScript =
    (tokens[0] === 'npm' && tokens[1] === 'run' && /^db:seed:/.test(tokens[2] ?? '')) ||
    (tokens[0] === 'node' && /scripts\/db\/seed\.ts$/.test(tokens[1] ?? ''));
  if (!isDbClient && !isSeedScript) return null;
  const remote = extractDbHosts(tokens).filter((h) => !isLocalDbHost(h));
  if (remote.length === 0) return null;
  return { id: 'remote-database', reason: remoteDatabaseReason(remote), detail: tokens.join(' ') };
};

/** `PGHOST=db.example.com psql …` のように環境変数で接続先を指定する形 */
const checkPgHostAssignment = (assignment: string): DenyReason | null => {
  const m = /^PGHOST=(.+)$/.exec(assignment);
  if (!m) return null;
  const host = stripQuotes(m[1]);
  return isLocalDbHost(host) ? null : { id: 'remote-database', reason: remoteDatabaseReason([host]), detail: assignment };
};

/**
 * Codex の apply_patch をシェルコマンドとして呼んだ形（パッチ本文は引数かヒアドキュメント）。
 * パッチが触るパスを書き込み先として見る（既存マイグレーションの判定は Stop フックと apply_patch ツール側が担う）
 */
const checkPatchWrites = (command: string, tokens: string[], effectiveCwd: string, ctx: BashContext): DenyReason[] => {
  if (tokens[0] !== 'apply_patch') return [];
  const reasons: DenyReason[] = [];
  for (const p of extractPatchPaths(command)) {
    const abs = resolvePath(effectiveCwd, expandHome(p, ctx.homeDir));
    const rel = toRepoRelative(abs, ctx.repoRoot);
    const views = rel === null ? [abs] : [rel, abs];
    const sensitive = SENSITIVE_PATH_PATTERNS.find((r) => views.some((v) => r.pattern.test(v)));
    if (sensitive) reasons.push({ id: sensitive.id, reason: sensitive.reason, detail: p });
    if (PROTECTED_SYSTEM_PATHS.pattern.test(abs)) reasons.push({ id: PROTECTED_SYSTEM_PATHS.id, reason: PROTECTED_SYSTEM_PATHS.reason, detail: abs });
    if (!ctx.unlocked && rel !== null) {
      const rule = PROTECTED_PATHS.find((r) => r.pattern.test(rel));
      if (rule) reasons.push({ id: `protected-path:${rule.id}`, reason: protectedReason(rule.reason), detail: rel });
    }
  }
  return reasons;
};

/** supabase CLI 本体の語（`supabase` / `supabase@latest` / `./node_modules/.bin/supabase` / `/usr/local/bin/supabase`） */
const SUPABASE_BIN = /(?:^|\/)supabase(?:@[\w.-]+)?$/;
/** npx / npm exec のうち値を取るオプション */
const NPX_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(['-p', '--package', '-c', '--call', '--shell', '--node-arg', '-n']);
/** supabase CLI のグローバルオプションのうち値を取るもの */
const SUPABASE_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(['--workdir', '--output', '-o', '--profile', '--dns-resolver', '--network-id']);

/** supabase CLI の呼び出しなら、CLI 本体より後ろの引数を返す（それ以外は null） */
export const supabaseArgs = (tokens: string[]): string[] | null => {
  let i = 0;
  if (tokens[0] === 'npx') {
    i = 1;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      i += NPX_FLAGS_WITH_VALUE.has(tokens[i]) ? 2 : 1;
    }
  } else if (tokens[0] === 'npm' && (tokens[1] === 'exec' || tokens[1] === 'x')) {
    i = 2;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '--') {
        i += 1;
        break;
      }
      i += NPX_FLAGS_WITH_VALUE.has(tokens[i]) ? 2 : 1;
    }
  }
  if (i >= tokens.length || !SUPABASE_BIN.test(tokens[i])) return null;
  return tokens.slice(i + 1);
};

/**
 * supabase CLI でリモート（link 済み / 本番）プロジェクトに作用しないか。
 * 呼び出し方（npx の版指定 / npm exec / node_modules/.bin）とグローバルオプションを吸収したうえで、
 * サブコマンドが SUPABASE_REMOTE_SUBCOMMANDS に該当するか、--linked / ローカル以外の --db-url を伴えば拒否する
 */
const checkSupabaseRemote = (tokens: string[]): DenyReason | null => {
  const args = supabaseArgs(tokens);
  if (args === null) return null;
  const rule = FORBIDDEN_COMMANDS.find((r) => r.id === 'supabase-remote');
  if (!rule) return null;
  const positional: string[] = [];
  for (let i = 0; i < args.length && positional.length < 2; i += 1) {
    const t = args[i];
    if (t.startsWith('-')) {
      if (SUPABASE_FLAGS_WITH_VALUE.has(t)) i += 1;
      continue;
    }
    positional.push(t);
  }
  const deny = (why: string): DenyReason => ({ id: rule.id, reason: `${rule.reason}（${why}）`, detail: tokens.join(' ') });
  if (SUPABASE_REMOTE_SUBCOMMANDS.has(positional[0] ?? '') || SUPABASE_REMOTE_SUBCOMMANDS.has(positional.join(' '))) {
    return deny(`${positional.join(' ')} はリモートに作用する`);
  }
  if (args.includes('--linked')) return deny('--linked は link 済みプロジェクトを対象にする');
  const dbUrls = args.flatMap((t, i) => {
    if (t === '--db-url') return i + 1 < args.length ? [args[i + 1]] : [];
    return t.startsWith('--db-url=') ? [t.slice('--db-url='.length)] : [];
  });
  const remote = extractDbHosts(dbUrls).filter((h) => !isLocalDbHost(h));
  if (remote.length > 0) return deny(`接続先 ${remote.join(', ')} はローカルではない`);
  return null;
};

/** 秘密情報を持つ環境変数の値を参照していないか（存在確認の test / [ / [[ は除く） */
const checkSecretEnvReference = (text: string, tokens: string[]): DenyReason | null => {
  if (SECRET_REFERENCE_EXEMPT_HEADS.has(tokens[0] ?? '')) return null;
  const m = SECRET_ENV_REFERENCE_RULE.pattern.exec(text);
  return m ? { id: SECRET_ENV_REFERENCE_RULE.id, reason: SECRET_ENV_REFERENCE_RULE.reason, detail: m[0] } : null;
};

/** 秘密情報・認証情報のパスを参照していないか（読み書きを問わない） */
const checkSensitivePaths = (tokens: string[], effectiveCwd: string, ctx: BashContext): DenyReason[] => {
  const normalized = tokens.join(' ');
  if (SENSITIVE_PATH_ALLOWED_COMMANDS.some((re) => re.test(normalized))) return [];
  const reasons: DenyReason[] = [];
  for (const raw of tokens) {
    const candidates = [stripQuotes(raw)];
    const v = valueOfFlag(raw);
    if (v !== null) candidates.push(stripQuotes(v));
    for (const c of candidates) {
      const expanded = expandHome(c, ctx.homeDir);
      const abs = looksLikePath(expanded) ? resolvePath(effectiveCwd, expanded) : null;
      const views = [c, expanded];
      if (abs) {
        views.push(abs);
        const rel = toRepoRelative(abs, ctx.repoRoot);
        if (rel !== null) views.push(rel);
        const home = toHomeView(abs, ctx.homeDir);
        if (home !== null) views.push(home);
      }
      for (const rule of SENSITIVE_PATH_PATTERNS) {
        if (views.some((view) => rule.pattern.test(view))) {
          if (!reasons.some((r) => r.id === rule.id && r.detail === c)) {
            reasons.push({ id: rule.id, reason: rule.reason, detail: c });
          }
          break;
        }
      }
    }
  }
  return reasons;
};

const GIT_WRITE_SUBCOMMANDS: ReadonlySet<string> = new Set(['rm', 'mv', 'checkout', 'restore', 'apply', 'stash', 'clean', 'reset']);

/**
 * この単純コマンドが書き込む先の語を列挙する（書き込みでなければ空）。
 * `cat x > y` は y だけ、`cp a b` は b だけが書き込み先。元ファイル側に保護パスがあっても読むだけなので拒否しない。
 */
export const writeTargets = (segment: string, tokens: string[]): string[] => {
  const targets: string[] = [];
  for (const m of segment.matchAll(/(?:^|\s)>{1,2}\s*(\S+)/g)) targets.push(m[1]);
  const head = tokens[0];
  if (!WRITE_COMMANDS.has(head)) return targets;
  const positional = tokens.slice(1).filter((t) => !t.startsWith('-'));
  if (head === 'sed' || head === 'perl') {
    if (!tokens.some((t) => /^-[a-zA-Z]*i/.test(t) || t === '--in-place')) return targets;
    return [...targets, ...positional];
  }
  if (head === 'git') {
    const sub = gitSubcommandIndex(tokens);
    if (sub < 0 || !GIT_WRITE_SUBCOMMANDS.has(tokens[sub])) return targets;
    return [...targets, ...tokens.slice(sub + 1).filter((t) => !t.startsWith('-'))];
  }
  if (head === 'tar') {
    if (!tokens.some((t) => /^-?[a-zA-Z]*x/.test(t) || t === '--extract')) return targets;
    return [...targets, ...positional];
  }
  if (head === 'dd') return [...targets, ...tokens.filter((t) => t.startsWith('of=')).map((t) => t.slice(3))];
  if (COPY_LIKE_COMMANDS.has(head)) {
    return positional.length >= 2 ? [...targets, positional[positional.length - 1]] : targets;
  }
  return [...targets, ...positional];
};

/**
 * ハーネス自身と、その土台（CI・フック・指示書）、ホーム配下の設定、システム領域への書き込みでないか。
 * システム領域は UNLOCK_ENV でも解除しない
 */
const checkProtectedWrites = (segment: string, tokens: string[], effectiveCwd: string, ctx: BashContext): DenyReason[] => {
  const reasons: DenyReason[] = [];
  for (const raw of writeTargets(segment, tokens)) {
    const c = stripQuotes(raw);
    if (!looksLikePath(c) && !/^[\w.-]+$/.test(c)) continue;
    const abs = resolvePath(effectiveCwd, expandHome(c, ctx.homeDir));
    if (PROTECTED_SYSTEM_PATHS.pattern.test(abs)) {
      if (!reasons.some((r) => r.detail === abs)) reasons.push({ id: PROTECTED_SYSTEM_PATHS.id, reason: PROTECTED_SYSTEM_PATHS.reason, detail: abs });
      continue;
    }
    if (ctx.unlocked) continue;
    const rel = toRepoRelative(abs, ctx.repoRoot);
    if (rel !== null) {
      const rule = PROTECTED_PATHS.find((p) => p.pattern.test(rel));
      if (rule && !reasons.some((r) => r.detail === rel)) {
        reasons.push({ id: `protected-path:${rule.id}`, reason: protectedReason(rule.reason), detail: rel });
      }
      continue;
    }
    const home = toHomeView(abs, ctx.homeDir);
    if (home !== null) {
      const rule = PROTECTED_HOME_PATHS.find((p) => p.pattern.test(home));
      if (rule && !reasons.some((r) => r.detail === abs)) {
        reasons.push({ id: `protected-home:${rule.id}`, reason: rule.reason, detail: abs });
      }
    }
  }
  return reasons;
};

const protectedReason = (what: string): string =>
  `${what}。ハーネスの保護対象はエージェントが書き換えない。変更が必要なら人間が PR で行う（CODEOWNERS によりレビュー必須）。人間が意図して任せる場合はセッション起動時に OPENGREENTRACK_HARNESS_UNLOCK=1 を付ける`;

// ---------------------------------------------------------------------------------------------
// 公開 API: シェルコマンド
// ---------------------------------------------------------------------------------------------

/**
 * シェルコマンドを判定する。depth は `bash -c "…"` の入れ子の深さ（呼び出し側は省略する）
 */
export const evaluateBashCommand = (command: string, ctx: BashContext, depth = 0): Decision => {
  const reasons: DenyReason[] = [];
  const push = (r: DenyReason | null | undefined): void => {
    if (r && !reasons.some((x) => x.id === r.id && x.detail === r.detail)) reasons.push(r);
  };

  for (const rule of FORBIDDEN_COMMAND_WHOLE) {
    const m = rule.pattern.exec(command);
    if (m) push({ id: rule.id, reason: rule.reason, detail: m[0] });
  }
  // ヒアドキュメントの本文は展開されてファイルに書かれるため、秘密情報の参照だけは本文も見る
  for (const body of heredocBodies(command)) push(checkSecretEnvReference(body, []));

  let effectiveCwd = ctx.cwd;
  for (const segment of splitCommandSegments(command)) {
    const { assignments, tokens } = stripPrefixes(tokenize(segment));
    for (const a of assignments) {
      for (const rule of ENV_ASSIGNMENT_RULES) {
        if (rule.pattern.test(a)) push({ id: rule.id, reason: rule.reason, detail: a });
      }
      push(checkPgHostAssignment(a));
    }
    if (tokens.length === 0) continue;

    if (tokens[0] === 'cd' && tokens.length >= 2) {
      effectiveCwd = resolvePath(effectiveCwd, expandHome(stripQuotes(tokens[1]), ctx.homeDir));
    } else if (tokens[0] === 'cd') {
      effectiveCwd = ctx.homeDir;
    }

    const inner = innerShellScript(tokens);
    if (inner !== null && depth < MAX_SHELL_DEPTH) {
      for (const r of evaluateBashCommand(inner, { ...ctx, cwd: effectiveCwd }, depth + 1).reasons) push(r);
    }

    const detail = tokens.join(' ');
    for (const variant of commandVariants(tokens)) {
      const normalized = variant.join(' ');
      for (const rule of FORBIDDEN_COMMANDS) {
        if (rule.pattern.test(normalized)) push({ id: rule.id, reason: rule.reason, detail });
      }
    }
    push(checkGitPushToMain(tokens, ctx));
    push(checkNpmAddDependency(tokens));
    push(checkRecursiveRm(tokens, effectiveCwd, ctx));
    push(checkRemoteDatabase(tokens));
    push(checkSupabaseRemote(tokens));
    push(checkSecretEnvReference(segment, tokens));
    for (const r of checkSensitivePaths(tokens, effectiveCwd, ctx)) push(r);
    for (const r of checkProtectedWrites(segment, tokens, effectiveCwd, ctx)) push(r);
    for (const r of checkPatchWrites(command, tokens, effectiveCwd, ctx)) push(r);
  }
  return decide(reasons);
};

// ---------------------------------------------------------------------------------------------
// 公開 API: ファイルの書き込み（Edit / Write / apply_patch）
// ---------------------------------------------------------------------------------------------

export const evaluateFileWrite = (filePath: string, ctx: FileContext): Decision => {
  const abs = resolvePath(ctx.cwd, expandHome(filePath, ctx.homeDir));
  const rel = toRepoRelative(abs, ctx.repoRoot);

  if (rel === null) {
    if (ctx.tmpDirs.some((d) => isUnder(abs, d))) return allow();
    const home = toHomeView(abs, ctx.homeDir);
    if (home !== null && ALLOWED_HOME_WRITE_PATHS.some((re) => re.test(home))) return allow();
    const homeRule = home !== null ? PROTECTED_HOME_PATHS.find((p) => p.pattern.test(home)) : undefined;
    if (homeRule) return decide([{ id: `protected-home:${homeRule.id}`, reason: homeRule.reason, detail: abs }]);
    const sensitive = SENSITIVE_PATH_PATTERNS.find((p) => p.pattern.test(abs) || (home !== null && p.pattern.test(home)));
    if (sensitive) return decide([{ id: sensitive.id, reason: sensitive.reason, detail: abs }]);
    if (PROTECTED_SYSTEM_PATHS.pattern.test(abs)) return decide([{ id: PROTECTED_SYSTEM_PATHS.id, reason: PROTECTED_SYSTEM_PATHS.reason, detail: abs }]);
    return decide([{ id: 'write-outside-repo', reason: `リポジトリ外（${abs}）への書き込みは禁止。一時ファイルは一時ディレクトリに置く`, detail: abs }]);
  }

  const reasons: DenyReason[] = [];
  const sensitive = SENSITIVE_PATH_PATTERNS.find((p) => p.pattern.test(rel));
  if (sensitive) reasons.push({ id: sensitive.id, reason: sensitive.reason, detail: rel });

  if (!ctx.unlocked) {
    const protectedRule = PROTECTED_PATHS.find((p) => p.pattern.test(rel));
    if (protectedRule) reasons.push({ id: `protected-path:${protectedRule.id}`, reason: protectedReason(protectedRule.reason), detail: rel });
  }

  const migration = /^supabase\/migrations\/([^/]+)$/.exec(rel);
  if (migration) {
    const name = migration[1];
    if (ctx.existsInBase(rel)) {
      reasons.push({
        id: 'migration-immutable',
        reason: '既存のマイグレーションは編集・削除しない（AGENTS.md R9）。変更は新しいタイムスタンプのファイルを追加して行う',
        detail: rel,
      });
    } else if (!MIGRATION_FILENAME.test(name)) {
      reasons.push({
        id: 'migration-filename',
        reason: 'マイグレーションのファイル名は `<14桁タイムスタンプ>_<snake_case>.sql`（`npx supabase migration new <name>` の形式）にする',
        detail: rel,
      });
    }
  } else if (rel.startsWith('supabase/migrations/')) {
    reasons.push({ id: 'migration-subdir', reason: 'supabase/migrations/ 直下に .sql だけを置く', detail: rel });
  }

  return decide(reasons);
};

/** Codex の apply_patch 形式からファイルパスを取り出す */
export const extractPatchPaths = (patch: string): string[] => {
  const paths: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const m = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
    if (m) paths.push(m[1].trim());
  }
  return paths;
};

// ---------------------------------------------------------------------------------------------
// 公開 API: 秘密情報のスキャン
// ---------------------------------------------------------------------------------------------

export interface SecretFinding {
  file: string;
  line: number;
  id: string;
  label: string;
  /** 検出値の先頭だけ（ログに値を残さないため） */
  preview: string;
}

const previewOf = (value: string): string => `${value.slice(0, 6)}…(${value.length} 文字)`;

const shouldSkipFile = (file: string): boolean => SECRET_SCAN_SKIP_PATHS.some((re) => re.test(file));

/** allowlist は行全体ではなく一致した値に対して試す（同じ行にダミー値と本物が並んでいても本物は検出する） */
export const scanTextForSecrets = (text: string, file: string, startLine = 1): SecretFinding[] => {
  if (shouldSkipFile(file)) return [];
  const findings: SecretFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const p of SECRET_VALUE_PATTERNS) {
      const m = p.pattern.exec(line);
      if (!m || SECRET_VALUE_ALLOWLIST.some((re) => re.test(m[0]))) continue;
      findings.push({ file, line: startLine + i, id: p.id, label: p.label, preview: previewOf(m[0]) });
    }
  }
  return findings;
};

/** `git diff -U0` の出力から追加行だけを走査する */
export const scanDiffForSecrets = (diff: string): SecretFinding[] => {
  const findings: SecretFinding[] = [];
  let file = '';
  let line = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('+++ ')) {
      file = raw.replace(/^\+\+\+ (?:b\/)?/, '');
      continue;
    }
    if (raw.startsWith('--- ') || raw.startsWith('diff ') || raw.startsWith('index ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+')) {
      if (file !== '/dev/null') findings.push(...scanTextForSecrets(raw.slice(1), file, line));
      line += 1;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) {
      line += 1;
    }
  }
  return findings;
};
