import path from 'node:path';
import { defineConfig } from 'vitest/config';

// 算定ロジックの単体テスト用の設定（#34）。
// 純粋な計算コアは Node 環境で完結するため environment は 'node' で十分。
//
// UIコンポーネントのテスト（#209）:
// *.test.tsx も収集対象に含める。既存の純関数テスト（node 環境）へ影響を出さないため
// デフォルトの environment は 'node' のまま維持し、DOM が必要な .test.tsx 側で
// ファイル先頭に `// @vitest-environment jsdom` の docblock を書いて jsdom へ切り替える。
export default defineConfig({
  resolve: {
    // tsconfig.json の paths（"@/*" → "./src/*"）と同じ解決をテストでも有効にする
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // `import 'server-only'`（src/lib/supabase/admin.ts）は Next のバンドラだけが解決する仮想モジュール。
      // vitest ではリポジトリ内の空モジュールへ向け、サーバ専用モジュールを読み込むテストが落ちないようにする。
      // node_modules 配下を直接指すと、依存を親ディレクトリから解決する作業用チェックアウトや
      // 巻き上げ先が異なる構成でパスが存在せず、そのテストファイルが丸ごと読み込み失敗になる。
      'server-only': path.resolve(__dirname, 'src/lib/testing/serverOnlyStub.ts'),
    },
  },
  test: {
    // scripts/ 配下の開発用スクリプトも収集対象に含める（scripts/db/check-migrations.ts など）。
    // CI・pre-commit から呼ぶチェックは純関数部分を単体テストで守る必要があるため。
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
});
