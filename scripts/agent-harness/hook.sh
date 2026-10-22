#!/bin/sh
# AI エージェント用ハーネスの起動ラッパー。Claude Code（.claude/settings.json）と Codex（.codex/config.toml）の
# フックはこのファイルを `sh …/hook.sh` で呼び、判定本体の hook.ts を node で実行する。
#
# なぜ node を直接呼ばないか:
#   Claude Code は終了コードが 0 と 2 以外（node が無い 127、読み込み失敗の 1、タイムアウト）を「フックの失敗」として
#   ツール実行をそのまま通す。node が無い・古い・hook.ts が壊れている環境でエージェントが無言で自由になるのを防ぐため、
#   PreToolUse のときだけ安全側に倒して 2（拒否）を返す。Stop / PostToolUse / SessionStart は 2 を返すと
#   エージェントが止まれなくなる（Stop の無限ループ）ので、1 か元の終了コードで通す。
# 必要環境: POSIX sh と Node 24 以上（TypeScript を型消去で直接実行する）。macOS / Linux / WSL。

payload=$(cat)
dir=$(dirname "$0")

# $1 の理由を出し、PreToolUse なら 2（拒否）、それ以外は $2（既定 1）で終了する
fail_closed() {
  echo "[OpenGreenTrack ハーネス] $1" >&2
  case "$payload" in
    *'"PreToolUse"'*) exit 2 ;;
    *) exit "${2:-1}" ;;
  esac
}

if ! command -v node >/dev/null 2>&1; then
  fail_closed "node が見つかりません。Node 24 以上を入れてから再実行してください（PreToolUse は安全側に倒して拒否します）"
fi
major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)
case "$major" in
  ''|*[!0-9]*) fail_closed "node のバージョンを確認できませんでした。Node 24 以上が必要です" ;;
esac
if [ "$major" -lt 24 ]; then
  fail_closed "Node ${major} は古く、ハーネス（TypeScript の直接実行）を動かせません。Node 24 以上にしてください"
fi

printf '%s' "$payload" | node "${dir}/hook.ts"
rc=$?
case "$rc" in
  0|2) exit "$rc" ;;
esac
case "$payload" in
  *'"PreToolUse"'*) fail_closed "hook.ts の実行に失敗しました（終了コード ${rc}）。安全側に倒してツールの実行を拒否します。scripts/agent-harness/ が壊れていないか確認してください" ;;
esac
exit "$rc"
