import { defineConfig, devices } from '@playwright/test';

// SSBJ 開示レポート（試行版 R1）の全体テスト（ローカル実行のみ。CI では走らせない）。
// OGT 本体のスモーク（playwright.config.ts / npm run test:e2e）とは設定を分け、本体のスモークには含めない
// （テストファイル名を *.e2e.ts にして、本体の testMatch（*.spec.ts）に掛からないようにしている）。
// 前提・実行方法・確認していることは docs/ssbj-spec.md §13「R1 の全体テスト（T14）」。
//
//   npx playwright test -c playwright.ssbj.config.ts
//
// ローカル Supabase の接続情報は .env.local から読む（本体の設定と同じく Node 標準の loadEnvFile を使う）。
try {
  process.loadEnvFile('.env.local');
} catch {
  // .env.local が無い環境ではシェルの環境変数をそのまま使う（足りなければ globalSetup が理由を出して落とす）。
}

// 既定は本体と同じ http://localhost:3000。別ポートの dev サーバを見るときは E2E_BASE_URL で指定する
// （その場合サーバの起動は実行者側の責任）。
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e/ssbj',
  testMatch: /.*\.e2e\.ts/,
  // 1 本のシナリオが同じレポートを順に育てていくため、並列実行しない。
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // dev サーバは画面ごとに初回コンパイルが走るため、1 ステップに余裕を持たせる。
  timeout: 240_000,
  expect: { timeout: 30_000 },
  globalSetup: './e2e/ssbj/global-setup.ts',
  globalTeardown: './e2e/ssbj/global-teardown.ts',
  use: {
    ...devices['Desktop Chrome'],
    // Playwright のブラウザを入れていない環境では、E2E_BROWSER_CHANNEL=msedge などでインストール済みのブラウザを使う。
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    baseURL,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
