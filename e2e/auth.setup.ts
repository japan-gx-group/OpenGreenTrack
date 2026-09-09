// スモークシナリオ1: ログイン → ダッシュボードが表示される。
//
// 検証を兼ねたセットアップ。ここで得たセッションを storageState に保存し、
// 後続のスモーク（smoke.spec.ts）はログインをやり直さずに本題から始める。

import { test as setup, expect } from '@playwright/test';
import { AUTH_STATE_PATH, TEST_USER } from './support/testData';

setup('ログインするとダッシュボードが表示される', async ({ page }) => {
  await page.goto('/login');

  await page.locator('#login-email').fill(TEST_USER.email);
  await page.locator('#login-password').fill(TEST_USER.password);
  // 送信中は「ログイン中」に変わるため exact 指定で取り違えを防ぐ。
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();

  await page.waitForURL('**/dashboard');
  // サイドバーにも「ダッシュボード」があるため、見出し（Header の h1）で判定する。
  await expect(page.getByRole('heading', { name: 'ダッシュボード', level: 1 })).toBeVisible();
  // 総排出量まで描画されて初めて「ダッシュボードが表示された」と言える（データ取得も通っている）。
  await expect(page.getByTestId('dashboard-total-emissions')).toBeVisible();

  await page.context().storageState({ path: AUTH_STATE_PATH });
});
