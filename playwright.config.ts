import { defineConfig, devices } from '@playwright/test';
import { AUTH_STATE_PATH } from './e2e/support/testData';

// ローカル Supabase への接続情報（NEXT_PUBLIC_SUPABASE_URL / ANON_KEY）は .env.local にある。
// Playwright は Next.js と違って .env.local を自動で読まないため、Node 標準の loadEnvFile で
// 明示的に読み込む（dotenv を新規依存に追加しないため。AGENTS.md「ライブラリを勝手に追加しない」）。
try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local が無い環境ではシェルの環境変数をそのまま使う（足りなければ globalSetup が案内して落とす）。
}

// 既定は開発サーバと同じ http://localhost:3000（AGENTS.md「ポート固定」）。
// 別ブランチの dev サーバが 3000 を使っている等で一時的に別ポートを見たいときだけ
// E2E_BASE_URL で上書きする。その場合サーバの起動は実行者側の責任になる。
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // スモークは同じローカルDBを書き換えながら進むため、並列実行しない。
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // 落ちた原因を握りつぶさないようリトライしない（不安定なら原因を直す方針）。
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // 手動入力の保存後に算定バッチ（/api/calculations）が走るぶん、既定の30秒では足りない。
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // ログイン導線そのものの検証を兼ねたセットアップ。成功したセッションを storageState に保存し、
    // 以降のスモークが毎回ログインし直さずに済むようにする。
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'smoke',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_STATE_PATH },
    },
  ],
  // E2E_BASE_URL 指定時は「すでに動いているサーバを見る」意図なので Playwright からは起動しない。
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        // ローカルでは既に 3000 で dev サーバが動いていれば再利用する（起動待ちを省ける）。
        // 別ブランチのサーバを見てしまう注意点は docs/e2e-testing.md に記載。
        // CI では「たまたま生き残ったプロセス」を掴むと検証対象がすり替わるため再利用しない。
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
