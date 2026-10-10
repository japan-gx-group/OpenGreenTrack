// SSBJ 開示レポート（試行版）の、承認ロック（自己承認の禁止を含む）・操作履歴・版の復元・Excel 出力・穴埋めテンプレート・2 画面エディタの全体テスト。
// 実画面と実データ（ローカル Supabase のデモシード）で、1 つのレポートを順に操作して確かめる（手順は順番に実行する）。
// 前提・実行方法は docs/ssbj-spec.md §13（r1-acceptance.e2e.ts と同じ設定 playwright.ssbj.config.ts で動く）。

import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FISCAL_YEAR_LABEL,
  ORG_A_LOGGER,
  ORG_A_USER,
  ORG_A_VIEWER,
  ORG_B_USER,
  SSBJ_E2E_TITLE_PREFIX,
  addDecimals,
  createUserClient,
  expectToast,
  parseSsbjCsv,
  rememberScope3DirectValue,
  restoreScope3DirectValue,
  signIn,
} from './support';

test.describe.configure({ mode: 'serial' });

const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const TITLE = `${SSBJ_E2E_TITLE_PREFIX} 承認・履歴・復元 ${RUN}`;
const APPROVED_TEXT = `サステナビリティ関連（気候関連を含む）のリスク及び機会は、取締役会が監督している（E2E ${RUN}）。`;
const CHANGED_TEXT = `差戻し後に書き換えた文章（E2E ${RUN}）。`;
const OVERSIGHT = '監督する機関・責任者';

let context: BrowserContext;
let page: Page;
// 承認者（算定 花子）。書く人（管理者 = page）と承認する人を分けるため、承認は承認者の画面で行う。
let approverContext: BrowserContext;
let approverPage: Page;
let orgA: SupabaseClient;
let reportId = '';
let fiscalYearId = '';
let approvedVersionId = '';

const reportPath = (path = '') => `/ssbj/${reportId}${path}`;
const narrativeCard = (target: Page = page) => target.getByTestId('ssbj-narrative-item')
  .filter({ has: target.getByRole('heading', { name: OVERSIGHT, exact: true }) });

const reportRow = async () => {
  const { data, error } = await orgA.from('ssbj_reports')
    .select('status, approverUserId, approvedVersionId, draftRevision').eq('id', reportId).single();
  if (error) throw error;
  return data as { status: string; approverUserId: string | null; approvedVersionId: string | null; draftRevision: number };
};

const auditActions = async (): Promise<string[]> => {
  const { data, error } = await orgA.from('ssbj_audit_logs').select('action').eq('reportId', reportId).order('id');
  if (error) throw error;
  return (data ?? []).map(row => row.action as string);
};

const statusCard = (target: Page = page) => target.getByTestId('ssbj-report-status-card');

const userIdOf = async (client: SupabaseClient): Promise<string> => {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('利用者の ID を取得できませんでした');
  return data.user.id;
};

const postStatus = (target: Page, data: Record<string, unknown>) =>
  target.request.post(`/api/ssbj/reports/${reportId}/status`, { data });

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  orgA = await createUserClient(ORG_A_USER);
  await signIn(page, ORG_A_USER);
  approverContext = await browser.newContext();
  approverPage = await approverContext.newPage();
  await signIn(approverPage, ORG_A_LOGGER);
});

test.afterAll(async () => {
  await approverContext?.close();
  await context?.close();
});

test('1. レポートを作ると、一覧に「作成中」と出て、操作履歴に作成が残る', async () => {
  await page.goto('/ssbj');
  await page.getByTestId('fiscal-year-menu').click();
  await page.getByRole('option', { name: new RegExp(`^${FISCAL_YEAR_LABEL}`) }).click();
  await page.getByRole('button', { name: '新規作成' }).click();
  await page.getByRole('dialog').getByLabel(/レポート名/).fill(TITLE);
  await page.getByRole('dialog').getByRole('button', { name: '作成する' }).click();
  await expectToast(page, 'SSBJレポートを作成しました');
  await expect(page.getByRole('row').filter({ hasText: TITLE })).toContainText('作成中');
  await page.getByRole('link', { name: TITLE }).click();
  await page.waitForURL(/\/ssbj\/[0-9a-f-]{36}$/);
  reportId = page.url().split('/').pop()!;
  const { data } = await orgA.from('ssbj_reports').select('fiscalYearId').eq('id', reportId).single();
  fiscalYearId = data!.fiscalYearId as string;
  expect(await auditActions()).toEqual(['create']);
});

test('2. 穴埋めテンプレートを入れ、【 】が残ったままでは入力済みにできない。入力中の文章は右側のプレビューにその場で出る', async () => {
  await page.goto(reportPath('/narratives'));
  const card = narrativeCard();
  await card.getByRole('button', { name: '編集' }).click();
  await card.getByRole('button', { name: 'テンプレートを入れる' }).click();
  await expect(card.getByTestId('ssbj-template-placeholders')).toContainText('1 か所');
  await card.getByRole('button', { name: '保存', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('【 】の部分（1 か所）');

  await card.getByLabel('開示する文章', { exact: true }).fill(APPROVED_TEXT);
  await expect(page.getByTestId('ssbj-editor-unsaved')).toBeVisible();
  await expect(page.getByTestId('ssbj-editor-preview')).toContainText(APPROVED_TEXT);
  await card.getByRole('button', { name: '保存', exact: true }).click();
  await expect(card).toContainText(APPROVED_TEXT);
  await expect(page.getByTestId('ssbj-editor-unsaved')).toBeHidden();
});

test('3. 右側の OGT の値（カンペ）に最新の値が出て、採用後に OGT の値が変わると入力画面の上部で知らせる', async () => {
  await page.goto(reportPath('/ghg'));
  await page.getByRole('button', { name: '表示中の候補値を採用する' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '採用する', exact: true }).click();
  await expect(page.getByText(/採用済み（/)).toBeVisible();

  await page.goto(reportPath('/narratives'));
  await page.getByRole('tab', { name: 'OGT の値' }).click();
  await expect(page.getByTestId('ssbj-ogt-reference').locator('tbody tr')).toHaveCount(18);
  await expect(page.getByTestId('ssbj-ogt-change-banner')).toHaveCount(0);

  const { data: direct } = await orgA.from('scope3_category_emissions').select('id, emissions')
    .eq('fiscalYearId', fiscalYearId).order('categoryId', { ascending: false }).limit(1).single();
  await rememberScope3DirectValue({ id: direct!.id as string, emissions: String(direct!.emissions) });
  try {
    await orgA.from('scope3_category_emissions').update({ emissions: addDecimals([String(direct!.emissions), '1']) }).eq('id', direct!.id);
    await page.reload();
    await expect(page.getByTestId('ssbj-ogt-change-banner')).toContainText('カテゴリ');
  } finally {
    await restoreScope3DirectValue();
  }
});

test('4. 自分以外の承認者を指定してレビューを依頼する。依頼した本人・承認者でも管理者でもない人は承認できない（画面・API とも）', async ({ browser }) => {
  await page.goto(reportPath());
  const approverSelect = page.locator('#ssbj-status-approver');
  // 自分（管理者の環境 太郎）は承認者に選べない。API で自分を指定しても拒否される。
  await expect(approverSelect.locator('option', { hasText: '算定 花子' })).toHaveCount(1);
  await expect(approverSelect.locator('option', { hasText: '環境 太郎' })).toHaveCount(0);
  const self = await postStatus(page, {
    action: 'submit', expectedDraftRevision: (await reportRow()).draftRevision, approverUserId: await userIdOf(orgA),
  });
  expect(self.status()).toBe(403);
  expect((await self.json()).error).toContain('自分を承認者に指定することはできません');
  expect((await reportRow()).status).toBe('draft');

  await approverSelect.selectOption({ label: '算定 花子' });
  await page.getByLabel('コメント（任意。操作履歴に残ります）').fill('確認をお願いします');
  await page.getByRole('button', { name: 'レビューを依頼する' }).click();
  await expectToast(page, 'レビューを依頼しました');
  await expect(statusCard()).toContainText('レビュー中');
  expect((await reportRow()).status).toBe('in_review');

  // 依頼した本人は、管理者でも承認できない。
  await expect(statusCard().getByRole('button', { name: '承認する' })).toBeDisabled();
  await expect(statusCard()).toContainText('レビューを依頼した本人は承認できません');
  const own = await postStatus(page, { action: 'approve', expectedDraftRevision: (await reportRow()).draftRevision });
  expect(own.status()).toBe(403);
  expect((await own.json()).error).toContain('レビューを依頼した本人は承認できません');

  // 承認者でも管理者でもない人は承認できない。
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, ORG_A_VIEWER);
  await otherPage.goto(reportPath());
  const card = statusCard(otherPage);
  await expect(card.getByRole('button', { name: '承認する' })).toBeDisabled();
  await expect(card).toContainText('指定された承認者か、管理者だけが操作できます');
  const response = await postStatus(otherPage, { action: 'approve', expectedDraftRevision: (await reportRow()).draftRevision });
  expect(response.status()).toBe(403);
  await otherContext.close();
  expect((await reportRow()).status).toBe('in_review');
});

test('5. 指定された承認者が承認すると、その時点の内容で保存版を作り、作業中の内容を編集できなくする（画面・DB・API のどこからも）', async () => {
  await approverPage.goto(reportPath());
  await approverPage.getByRole('button', { name: '承認する' }).click();
  await expectToast(approverPage, /承認しました（承認した内容を 版 1 として保存しました）/);
  await expect(approverPage.getByTestId('ssbj-locked-notice')).toBeVisible();
  await expect(approverPage.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);

  const row = await reportRow();
  expect(row.status).toBe('approved');
  approvedVersionId = row.approvedVersionId!;
  const { data: version } = await orgA.from('ssbj_report_versions').select('note, snapshot').eq('id', approvedVersionId).single();
  expect(version!.note).toBe('承認時の保存版');
  expect(JSON.stringify(version!.snapshot)).toContain(APPROVED_TEXT);

  await page.goto(reportPath('/narratives'));
  await expect(page.getByTestId('ssbj-locked-notice')).toBeVisible();
  await expect(narrativeCard().getByRole('button', { name: '編集' })).toHaveCount(0);

  // 画面を通さずに書き込んでも DB が止める。
  const { error } = await orgA.from('ssbj_narratives').update({ disclosureText: '書き換え' })
    .eq('reportId', reportId).eq('itemId', 'governance.oversight_body').select('itemId');
  expect(error?.code).toBe('P2051');
  const { error: insertError } = await orgA.from('ssbj_judgements')
    .insert({ organizationId: (await orgA.from('ssbj_reports').select('organizationId').eq('id', reportId).single()).data!.organizationId,
      reportId, requirementId: 'REQ-GEN-009' });
  expect(insertError?.code).toBe('P2051');
  const adoption = await page.request.post(`/api/ssbj/reports/${reportId}/ogt-adoption`, {
    data: { expectedFingerprint: '0123456789abcdef' },
  });
  expect(adoption.status()).toBe(409);
  expect((await adoption.json()).error).toContain('承認済み');
});

test('6. 承認済みでも保存版の出力はでき、Excel の中身は CSV と同じ', async () => {
  await page.goto(reportPath('/versions'));
  await expect(page.getByRole('button', { name: 'この版の内容に戻す' })).toHaveCount(0);
  const item = page.getByRole('listitem').filter({ hasText: '承認した版' });
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: 'CSVを出力' }).click()]);
  const csv = parseSsbjCsv(await readFile((await csvDownload.path())!));
  const [xlsxDownload] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: 'Excelを出力' }).click()]);
  expect(xlsxDownload.suggestedFilename()).toMatch(/^SSBJ_社内確認用_版1_.*\.xlsx$/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await xlsxDownload.path())!);
  const sheet = workbook.getWorksheet('SSBJレポート')!;
  const xlsxRows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, row => {
    const values = (row.values as unknown[]).slice(1).map(value => (value === null || value === undefined ? '' : String(value)));
    xlsxRows.push(values);
  });
  const withoutGeneratedAt = (rows: string[][]) =>
    rows.filter(row => row[0] !== '生成日時').map(row => row.slice(0, 8)).filter(row => row.some(cell => cell !== ''));
  const trimRight = (rows: string[][]) => rows.map(row => {
    const cells = [...row];
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  });
  expect(trimRight(withoutGeneratedAt(xlsxRows))).toEqual(trimRight(withoutGeneratedAt(csv)));
  expect(xlsxRows.some(row => row.includes(APPROVED_TEXT))).toBe(true);
  await expect(page.getByText(/Excel · 版 1/)).toBeVisible();
});

test('7. 理由を書かないと差戻せない。管理者が理由を書いて差戻すとロックが外れ、書き換えた後で、承認した版の内容に戻せる（戻す前の内容は自動で保存版になる）', async () => {
  const noReason = await postStatus(page, { action: 'reopen', expectedDraftRevision: (await reportRow()).draftRevision });
  expect(noReason.status()).toBe(400);
  expect((await noReason.json()).error).toContain('差戻しの理由を入力してください');
  expect((await reportRow()).status).toBe('approved');

  await page.goto(reportPath());
  await page.getByRole('button', { name: '差戻す' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '差戻す' })).toBeDisabled();
  await dialog.getByLabel('差戻しの理由（必須）').fill('数値を見直してください');
  await dialog.getByRole('button', { name: '差戻す' }).click();
  await expectToast(page, '作成中に戻しました');
  expect((await reportRow()).status).toBe('draft');

  await page.goto(reportPath('/narratives'));
  const card = narrativeCard();
  await card.getByRole('button', { name: '編集' }).click();
  await card.getByLabel('開示する文章', { exact: true }).fill(CHANGED_TEXT);
  await card.getByRole('button', { name: '保存', exact: true }).click();
  await expect(card).toContainText(CHANGED_TEXT);

  await page.goto(reportPath('/versions'));
  await page.getByRole('listitem').filter({ hasText: '承認時の保存版' })
    .getByRole('button', { name: 'この版の内容に戻す' }).click();
  await expect(page.getByRole('dialog')).toContainText('自動で残します');
  await page.getByRole('dialog').getByRole('button', { name: 'この版の内容に戻す' }).click();
  await expect(page.getByRole('status').filter({ hasText: '版 1 の内容に戻しました' })).toContainText('版 2 として保存しています');

  const { data: narrative } = await orgA.from('ssbj_narratives').select('disclosureText')
    .eq('reportId', reportId).eq('itemId', 'governance.oversight_body').single();
  expect(narrative!.disclosureText).toBe(APPROVED_TEXT);
  const { data: backup } = await orgA.from('ssbj_report_versions').select('note, snapshot')
    .eq('reportId', reportId).eq('versionNumber', 2).single();
  expect(backup!.note).toBe('版 1 を復元する前の自動保存');
  expect(JSON.stringify(backup!.snapshot)).toContain(CHANGED_TEXT);
});

test('8. 操作履歴に、誰がいつ何をしたかが残り、CSV・Excel で出力できる', async () => {
  const actions = await auditActions();
  for (const action of ['create', 'update', 'status_change', 'version_create', 'export', 'version_restore']) {
    expect(actions, action).toContain(action);
  }
  expect(actions.filter(action => action === 'status_change')).toHaveLength(3);

  await page.goto(reportPath('/history'));
  const rows = page.getByTestId('ssbj-audit-row');
  await expect(rows.first()).toContainText('保存版の復元');
  await expect(rows.first()).toContainText('環境 太郎');
  await expect(page.locator('body')).not.toContainText('不明な利用者');
  await expect(rows.filter({ hasText: '承認（レビュー中 → 承認済み）' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'コメント: 数値を見直してください' })).toHaveCount(1);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excelで出力' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^SSBJ_操作履歴_.*\.xlsx$/);
  await expect.poll(async () => (await auditActions()).at(-1)).toBe('export');
});

test('9. 他の組織からは、操作履歴も状態の操作も届かない', async ({ browser }) => {
  const orgB = await createUserClient(ORG_B_USER);
  const { data, error } = await orgB.from('ssbj_audit_logs').select('id').eq('reportId', reportId);
  expect(error).toBeNull();
  expect(data).toEqual([]);
  const { error: exportError } = await orgB.rpc('record_ssbj_export', { p_report_id: reportId, p_format: 'csv' });
  expect(exportError?.code).toBe('P2031');

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signIn(pageB, ORG_B_USER);
  for (const path of ['/history', '/versions']) {
    await pageB.goto(reportPath(path));
    await expect(pageB.getByText('SSBJレポートが見つかりません').first()).toBeVisible();
  }
  const status = await pageB.request.post(`/api/ssbj/reports/${reportId}/status`, {
    data: { action: 'reopen', expectedDraftRevision: (await reportRow()).draftRevision },
  });
  expect(status.status()).toBe(404);
  const restore = await pageB.request.post(`/api/ssbj/reports/${reportId}/versions/${approvedVersionId}/restore`, {
    data: { expectedDraftRevision: (await reportRow()).draftRevision },
  });
  expect(restore.status()).toBe(404);
  await contextB.close();
});

test('10. レビューの依頼の後に内容を変更した承認者は承認できない（画面・API とも）', async () => {
  await page.goto(reportPath());
  await page.locator('#ssbj-status-approver').selectOption({ label: '算定 花子' });
  await page.getByRole('button', { name: 'レビューを依頼する' }).click();
  await expectToast(page, 'レビューを依頼しました');

  // 承認者が、依頼の後に作業中の内容を変える（画面を通さずに書いても、操作履歴で判定される）。
  const approverClient = await createUserClient(ORG_A_LOGGER);
  const { error } = await approverClient.from('ssbj_narratives').update({ internalNote: `承認者のメモ（E2E ${RUN}）` })
    .eq('reportId', reportId).eq('itemId', 'governance.oversight_body').select('itemId');
  expect(error).toBeNull();

  await approverPage.goto(reportPath());
  const card = statusCard(approverPage);
  await expect(card.getByRole('button', { name: '承認する' })).toBeDisabled();
  await expect(card).toContainText('レビューの依頼の後に内容を変更したため、承認できません');
  const response = await postStatus(approverPage, { action: 'approve', expectedDraftRevision: (await reportRow()).draftRevision });
  expect(response.status()).toBe(403);
  expect((await response.json()).error).toContain('レビューの依頼の後に内容を変更した人は承認できません');
  expect((await reportRow()).status).toBe('in_review');
});
