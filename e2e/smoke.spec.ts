// 基幹導線のスモークテスト。
// シナリオ1（ログイン → ダッシュボード）は auth.setup.ts が担当し、ここは残り3本を扱う。
//
// 前提: ローカル Supabase が起動し、supabase/seeds/demo/demo.sql が投入されていること（npm run db:reset:demo）。
// 実行方法・注意点は docs/e2e-testing.md を参照。

import { stat } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import {
  navigateTo,
  readDashboardTotal,
  saveManualActivityRecord,
  selectFiscalYear,
} from './support/pages';
import {
  DASHBOARD_BASELINE_MONTH,
  DASHBOARD_REFLECTION_TIMEOUT_MS,
  DASHBOARD_TARGET_MONTH,
  E2E_SEARCH_KEYWORD,
  EXPECTED_EMISSIONS_T_CO2E,
  SAVE_AND_CALCULATE_TIMEOUT_MS,
  SAVE_TARGET_MONTH,
  TEST_AMOUNT_KWH,
  TEST_FISCAL_YEAR_LABEL,
  TEST_LOCATION_NAME,
  toHistoryPeriodStart,
} from './support/testData';

test.describe('基幹導線スモーク', () => {
  test('データ入力フォームで活動量を保存でき、算定済みで入力履歴に残る', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateTo(page, 'データ入力', 'データ入力');

    await saveManualActivityRecord(page, SAVE_TARGET_MONTH);

    // 保存したレコードが入力履歴に出ること（＝DBに入り、一覧の再取得も通っている）。
    await page.locator('#history-search').fill(E2E_SEARCH_KEYWORD);

    // 拠点だけでは他のテストが作った e2e 行とも一致してしまい、実行順に依存する。
    // 対象期間まで指定して「このテストが保存した1件」を特定する。
    const historyRows = page
      .locator('table tbody tr')
      .filter({ hasText: TEST_LOCATION_NAME })
      .filter({ hasText: toHistoryPeriodStart(SAVE_TARGET_MONTH) });
    await expect(historyRows).toHaveCount(1);

    const savedRow = historyRows.first();
    await expect(savedRow).toContainText(TEST_AMOUNT_KWH.toLocaleString('ja-JP'));
    // 排出量の列が「未算定」のままなら、保存後の自動算定が結果を書けていない。
    await expect(savedRow).not.toContainText('未算定');
    await expect(savedRow).toContainText(String(EXPECTED_EMISSIONS_T_CO2E));
  });

  test('保存した活動量が算定され、ダッシュボードの総排出量に反映される', async ({ page }) => {
    // 保存＋算定を2回行うため、playwright.config.ts の既定（90秒）だと待ちの上限を使い切る前に
    // テスト側が先に切れ、「Test timeout exceeded」という原因の分からない失敗になる。
    // 実際に待ちうる最大値（保存2回 + 反映待ち）に操作ぶんの余裕を足した値にしておく。
    test.setTimeout(2 * SAVE_AND_CALCULATE_TIMEOUT_MS + DASHBOARD_REFLECTION_TIMEOUT_MS + 30_000);

    await page.goto('/dashboard');
    await navigateTo(page, 'データ入力', 'データ入力');

    // 1件目は基準値づくり。算定は年度の集計を実データから再計算するため、この保存で
    // dashboard_aggregates が「いまの実データと一致した値」に揃う（詳細は testData.ts のコメント）。
    await saveManualActivityRecord(page, DASHBOARD_BASELINE_MONTH);

    await navigateTo(page, 'ダッシュボード', 'ダッシュボード');
    await selectFiscalYear(page, TEST_FISCAL_YEAR_LABEL);
    const totalBefore = await readDashboardTotal(page);

    await navigateTo(page, 'データ入力', 'データ入力');
    await saveManualActivityRecord(page, DASHBOARD_TARGET_MONTH);

    // サイドバー経由のクライアント遷移なので、選択中の年度は保持される。
    await navigateTo(page, 'ダッシュボード', 'ダッシュボード');

    // 増分が算定結果ぴったりであることまで見る。「変化していればOK」だと、年度切替の待ち漏れで
    // 別年度の数値を読んでいても通ってしまうため。
    await expect
      .poll(() => readDashboardTotal(page), { timeout: DASHBOARD_REFLECTION_TIMEOUT_MS })
      .toBeCloseTo(totalBefore + EXPECTED_EMISSIONS_T_CO2E, 3);
  });

  test('レポート出力からCSVをダウンロードできる', async ({ page }) => {
    await page.goto('/dashboard');
    await navigateTo(page, 'レポート', 'レポート');

    // 対象拠点は初期表示で全選択済み。出力フォーマットだけ CSV に切り替える。
    await page.getByRole('button', { name: 'CSV (.csv) Excel対応' }).click();

    const downloadButton = page.getByRole('button', { name: 'CSVをダウンロード' });
    // このボタンが押せる時点で画面の初期ロードは完了しており、生成履歴も取得済み。
    await expect(downloadButton).toBeEnabled();

    const historyItems = page.getByTestId('report-history-item');
    const historyCountBefore = await historyItems.count();

    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.csv$/);

    // 空ファイルが落ちてくる不具合を検知するため、中身があることまで確認する。
    const downloadedPath = await download.path();
    const { size } = await stat(downloadedPath);
    expect(size).toBeGreaterThan(0);

    // 生成条件がレポート生成履歴に記録される（画面の説明どおりの挙動）。
    // seed が既に reports.generate の監査ログを入れているため「空表示が消えたか」では
    // 何も検証できない。件数が1件増えたことで見る。
    await expect(historyItems).toHaveCount(historyCountBefore + 1);
  });
});
