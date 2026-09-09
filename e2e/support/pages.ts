// スモークシナリオから使う画面操作のヘルパー。
// 個々の画面の詳細（要素の特定方法・待ち合わせ）はここへ寄せ、テスト本体は
// 「何を確かめたいか」だけが読めるようにする。

import { expect, type Page } from '@playwright/test';
import {
  E2E_NOTE_MARKER,
  SAVE_AND_CALCULATE_TIMEOUT_MS,
  TEST_AMOUNT_KWH,
  TEST_CATEGORY_LABEL,
  TEST_LOCATION_NAME,
} from './testData';

/** サイドバーのリンクで画面遷移する（遷移導線そのものもスモークの対象に含める）。 */
export const navigateTo = async (page: Page, linkLabel: string, headingText: string): Promise<void> => {
  // 画面見出しの「レポートを作成」など、本文側にも同じ行き先のリンクがあるためサイドバーに限定する。
  await page.locator('#app-sidebar').getByRole('link', { name: linkLabel, exact: true }).click();
  await expect(page.getByRole('heading', { name: headingText, level: 1 })).toBeVisible();
};

/** ダッシュボードの総排出量（t-CO2e）を数値で読む。 */
export const readDashboardTotal = async (page: Page): Promise<number> => {
  const text = await page.getByTestId('dashboard-total-emissions').innerText();
  // ja-JP の桁区切り（1,234.5）が入るのでカンマを落としてから数値化する。
  return Number(text.replace(/,/g, ''));
};

/** 年度切替後の再取得を待つ上限。既定の30秒だと、原因の分かりにくい待ちが長引くだけなので短めにする。 */
const FISCAL_YEAR_SWITCH_TIMEOUT_MS = 15_000;

/**
 * 画面見出しの年度メニューで会計年度を切り替え、その年度の集計が描画されるまで待つ。
 * 切替直後は「前の年度の数値を表示したまま」再取得する作りのため、レスポンスと
 * 更新中インジケータの両方を待たないと古い値を読んでしまう。
 */
export const selectFiscalYear = async (page: Page, label: string): Promise<void> => {
  // 切替前の取得が終わっていないと、下のレスポンス待ちが初回ロード分を拾ってしまう。
  await expect(page.getByTestId('dashboard-total-emissions')).toBeVisible();

  const trigger = page.getByTestId('fiscal-year-menu');
  await expect(trigger).toBeEnabled();

  // すでにその年度が選ばれている場合、選び直しても React の state が変わらず再取得が走らない。
  // 下のレスポンス待ちが永久に解けないので、ここで抜ける（表示は初回ロードのぶんで確定済み）。
  if ((await trigger.innerText()).includes(label)) {
    await expect(page.getByText('最新のデータに更新しています')).toBeHidden();
    return;
  }

  await trigger.click();
  const option = page.getByRole('option', { name: new RegExp(label) }).first();
  await expect(option).toBeVisible();

  const aggregatesLoaded = page.waitForResponse(
    (response) => response.url().includes('dashboard_aggregates') && response.ok(),
    { timeout: FISCAL_YEAR_SWITCH_TIMEOUT_MS },
  );
  await option.click();
  try {
    await aggregatesLoaded;
  } catch (error) {
    throw new Error(
      `年度「${label}」への切替後、dashboard_aggregates の再取得が観測できませんでした。` +
        `年度メニューの実装かダッシュボードの取得処理が変わっていないか確認してください: ${String(error)}`,
    );
  }
  await expect(page.getByText('最新のデータに更新しています')).toBeHidden();
};

/**
 * データ入力画面の入力フォームから活動量（Scope 1・2 の電気）を1件保存し、保存後に自動で走る算定の完了まで待つ。
 * 備考にはテストの目印（E2E_NOTE_MARKER）を入れ、後片付けで特定できるようにする。
 */
export const saveManualActivityRecord = async (page: Page, targetMonth: string): Promise<void> => {
  await page.locator('#manual-location-select').selectOption({ label: TEST_LOCATION_NAME });
  await page.locator('#manual-category-select').selectOption({ label: TEST_CATEGORY_LABEL });
  await page.locator('#manual-target-month').fill(targetMonth);
  await page.locator('#manual-amount-input').fill(String(TEST_AMOUNT_KWH));
  await page.locator('#manual-note-input').fill(E2E_NOTE_MARKER);

  // 係数の取得が終わる前にプレビューを開くと、適用係数が未確定のまま保存されてしまう。
  await expect(page.getByText('排出係数を取得しています')).toBeHidden();

  await page.locator('#manual-preview-button').click();
  const previewModal = page.locator('.modal-content');
  await expect(previewModal.getByRole('heading', { name: '入力内容の確認' })).toBeVisible();
  // 適用できる係数が無いと推定排出量が「—」になる。t-CO2e が出ていれば算定できる状態。
  await expect(previewModal).toContainText('t-CO2e');

  await page.locator('#manual-save-button').click();

  // 保存 → 算定まで一気に走る導線なので、算定完了のトーストが出るまでが1操作。
  // 画面には他にも role="status" の要素（読み込み表示など）があり得るため、トースト本体を直接指す。
  await expect(page.locator('.toast')).toContainText('排出量の自動計算が完了しました', {
    timeout: SAVE_AND_CALCULATE_TIMEOUT_MS,
  });
};
