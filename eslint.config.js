import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'

// 'use client' の有無とファイル名（<Name>.client.tsx）を突き合わせる自前ルール（AGENTS.md R6）。
// 対象は src/ 配下の .tsx コンポーネント。src/app/ の規約ファイル（page / layout / error 等）は
// Next.js が名前を決めるため対象外。ライブラリを増やさずに済むよう flat config 内に直接定義する。
const clientComponentFilename = {
  meta: {
    type: 'problem',
    docs: { description: "'use client' を持つコンポーネントは <Name>.client.tsx と命名する" },
    schema: [],
  },
  create(context) {
    const filename = context.filename ?? context.getFilename()
    const isClientNamed = filename.endsWith('.client.tsx')
    return {
      Program(node) {
        const hasDirective = node.body.some(
          statement =>
            statement.type === 'ExpressionStatement' &&
            statement.directive === 'use client',
        )
        if (hasDirective && !isClientNamed) {
          context.report({
            node: node.body[0] ?? node,
            message: "'use client' を持つコンポーネントは <Name>.client.tsx と命名してください（AGENTS.md R6）",
          })
        } else if (!hasDirective && isClientNamed) {
          context.report({
            node: node.body[0] ?? node,
            message: ".client.tsx のファイルには先頭に 'use client' が必要です（AGENTS.md R6）",
          })
        }
      },
    }
  },
}

export default defineConfig([
  // '.claude' はエージェントが作る git worktree（.claude/worktrees/*）の置き場で、
  // 1本ごとにリポジトリ全体の複製とビルド成果物を含む。除外しないと `eslint .` が
  // worktree 本数ぶんのソースとミニファイ済みバンドルまで走査し、実行が数分に伸びたうえ
  // 追跡対象外のコードの指摘で結果が埋まる（本体のみなら数秒で完了する）。
  globalIgnores([
    '.next',
    'out',
    'dist',
    'node_modules',
    'next-env.d.ts',
    'personal-notes',
    '.claude',
    // Supabase CLI が生成する作業用ディレクトリ（supabase/.gitignore で除外済みだが、
    // ESLint flat config は .gitignore を読まないため個別に指定する）。
    'supabase/.temp',
    // Playwright の実行結果（HTMLレポートにはミニファイ済みのバンドルが含まれる）。
    'playwright-report',
    'test-results',
    'blob-report',
  ]),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    rules: {
      'no-trailing-spaces': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  ...nextVitals,
  {
    files: ['**/*.{jsx,tsx}'],
    // type を省いた <button> は <form> の中に置かれた瞬間に送信ボタンになり、部品を再利用した先で
    // submit が暴発する。手作業の掃除では取りこぼしが続いたため lint で機械的に締める。
    // react プラグインは eslint-config-next が登録済みのものを使う（依存を増やさない）。
    rules: {
      'react/button-has-type': 'error',
    },
  },
  {
    files: ['src/**/*.tsx'],
    // src/components/ui/ の小文字始まりは shadcn/ui CLI が生成・更新するファイル。
    // CLI の命名規約（select.tsx 等）を守る必要があるため .client 接尾辞の対象外にする（AGENTS.md R6 / R14）
    ignores: ['src/app/**', 'src/components/ui/[a-z]*.tsx'],
    plugins: {
      greentrack: { rules: { 'client-component-filename': clientComponentFilename } },
    },
    rules: {
      'greentrack/client-component-filename': 'error',
    },
  },
])
