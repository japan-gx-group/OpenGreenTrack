// SSBJ 開示レポート R2 の通し試験。R2 を実際の企業のデータで使う前に、外せない 4 つの条件を確かめる:
//   1. 権限の無い操作が必ず拒否される（画面・API・PostgREST の直接呼び出しのどこからも）
//   2. 数値が合う（OGT の算定値と外部算定値を二重に計上しない）
//   3. 根拠を辿れる（外部算定値から、根拠文書・算定した者・確認者・操作履歴まで）
//   4. 承認した内容が後から変わらない（自己承認の拒否と、元データ・根拠・拠点名を変えた後の保存版）
// 実画面と実データ（ローカル Supabase のデモシード）で、1 つのレポートを順に操作して確かめる（手順は順番に実行する）。
// 入力は入力担当（算定 花子）、承認は承認担当（確認 三郎）、閲覧は閲覧者（報告 次郎）が行い、管理者（環境 太郎）は
// レビューの依頼・差戻しと、OGT の元データの変更に使う。前提・実行方法は docs/ssbj-spec.md §13（設定は playwright.ssbj.config.ts）。
// 内部メモ・内部記録は、画面のプレビューで「内部メモも表示する」を選んだときだけ出て、印刷・PDF と閲覧者には出ない（手順 8・10）。

import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SsbjExternalEmissionSnapshot, SsbjReportSnapshotV1 } from '../../src/features/ssbj/types';
import { ogtValueKey } from '../../src/features/ssbj/utils/ogtValue';
import {
  FISCAL_YEAR_LABEL,
  ORG_A_APPROVER,
  ORG_A_LOGGER,
  ORG_A_USER,
  ORG_A_VIEWER,
  SSBJ_E2E_TITLE_PREFIX,
  addDecimals,
  createUserClient,
  expectToast,
  parseSsbjCsv,
  rememberLocationName,
  rememberScope3DirectValue,
  restoreLocationName,
  restoreScope3DirectValue,
  signIn,
} from './support';

test.describe.configure({ mode: 'serial' });

const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const TITLE = `${SSBJ_E2E_TITLE_PREFIX} R2 通し試験 ${RUN}`;
const EVIDENCE_TITLE = `燃料使用量の算定書（E2E ${RUN}）`;
const EVIDENCE_TITLE_CHANGED = `燃料使用量の算定書・改訂版（E2E ${RUN}）`;
const CALCULATED_BY = `架空環境コンサルティング（E2E ${RUN}）`;
const EXTERNAL_VALUE = '0.750';
const EXTERNAL_VALUE_CHANGED = '0.900';
const OVERLAP_WITH_OGT = 'OGT の採用値に含まれています';

// CSV の列: 章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記
const COLUMN = { group: 0, target: 1, item: 2, state: 3, disclosure: 4, internal: 6, note: 7 } as const;
const OGT_GROUP = 'GHG排出量';
const EXTERNAL_GROUP = 'GHG排出量（外部算定値）';

type Version = { id: string; versionNumber: number; snapshot: SsbjReportSnapshotV1 };

// 画面と、その人の Supabase クライアント（RLS の下で動く）。
type Actor = { context: BrowserContext; page: Page; client: SupabaseClient; userId: string };

let admin: Actor;
let editor: Actor;
let approver: Actor;
let viewer: Actor;
let organizationId = '';
let fiscalYearId = '';
let reportId = '';
let evidenceId = '';
let externalId = '';
let version1: Version | null = null;
let approvedVersionId = '';

const reportPath = (path = '') => `/ssbj/${reportId}${path}`;

const openActor = async (browser: Browser, user: Parameters<typeof signIn>[1]): Promise<Actor> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, user);
  const client = await createUserClient(user);
  const { data } = await client.auth.getUser();
  return { context, page, client, userId: data.user!.id };
};

const reportRow = async () => {
  const { data, error } = await admin.client.from('ssbj_reports')
    .select('title, status, approvedVersionId, draftRevision').eq('id', reportId).single();
  if (error) throw error;
  return data as { title: string; status: string; approvedVersionId: string | null; draftRevision: number };
};

const versionsOfReport = async (client: SupabaseClient = admin.client): Promise<Version[]> => {
  const { data, error } = await client.from('ssbj_report_versions')
    .select('id, versionNumber, snapshot').eq('reportId', reportId).order('versionNumber');
  if (error) throw error;
  return (data ?? []) as Version[];
};

/** 外部算定値の行（画面を通さずに書くときの共通の値）。 */
const externalRow = (overrides: Record<string, unknown>) => ({
  organizationId, reportId, scope: 1, gases: ['CH4'], value: '1', periodStart: '2024-04-01', periodEnd: '2025-03-31',
  calculatedBy: CALCULATED_BY, calculationMethod: '燃料の使用量×係数（E2E）', evidenceId,
  confirmedByUserId: admin.userId, confirmedAt: new Date().toISOString(), ...overrides,
});

/** 保存履歴の画面から、指定の版の CSV を出力して読む（生成日時の行は比べられないので除く）。 */
const downloadVersionCsv = async (page: Page, versionNumber: number): Promise<string[][]> => {
  await page.goto(reportPath('/versions'));
  const item = page.getByRole('listitem').filter({ has: page.getByText(`版 ${versionNumber}`, { exact: true }) });
  const [download] = await Promise.all([page.waitForEvent('download'), item.getByRole('button', { name: 'CSVを出力' }).click()]);
  return parseSsbjCsv(await readFile((await download.path())!)).filter(row => row[0] !== '生成日時');
};

/**
 * 印刷ビュー（PDF と同じ内容）を、印刷ダイアログを出さずに開く。印刷には内部メモ・内部記録を出さない。
 * URL に internal=1 を付けても出ないことを確かめられるよう、付けて開くこともできる。
 */
const openPrintView = async (actor: Actor, source: string, extraQuery = ''): Promise<Page> => {
  const print = await actor.context.newPage();
  await print.addInitScript(() => { window.print = () => undefined; });
  await print.goto(reportPath(`/preview/print?source=${source}${extraQuery}`));
  await expect(print.getByTestId('ssbj-preview-source')).toBeVisible();
  return print;
};

/** 画面のプレビューで、指定の内容（作業中 / 保存版の ID）を「内部メモも表示する」を選んで開き、外部算定値の欄を返す。 */
const openPreviewWithInternalNotes = async (actor: Actor, source: string) => {
  await actor.page.goto(reportPath(source === 'working' ? '/preview' : `/preview?source=${source}`));
  await expect(actor.page.getByTestId('ssbj-preview-source')).toBeVisible();
  await actor.page.getByLabel('内部メモも表示する（開示しない内容）').click();
  return actor.page.getByTestId('ssbj-preview-external-emissions');
};

const adoptOnScreen = async (page: Page) => {
  await page.goto(reportPath('/ghg'));
  await page.getByRole('button', { name: /表示中の候補値(を採用する|で採用し直す)/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: '採用する', exact: true }).click();
};

test.beforeAll(async ({ browser }) => {
  admin = await openActor(browser, ORG_A_USER);
  editor = await openActor(browser, ORG_A_LOGGER);
  approver = await openActor(browser, ORG_A_APPROVER);
  viewer = await openActor(browser, ORG_A_VIEWER);
  const { data } = await admin.client.from('profiles').select('organizationId').eq('id', admin.userId).single();
  organizationId = data!.organizationId as string;
});

test.afterAll(async () => {
  for (const actor of [admin, editor, approver, viewer]) await actor?.context.close();
});

test('1. 入力担当がレポートを作り、OGT の値を採用し、外部算定値の根拠文書を登録する', async () => {
  const { page } = editor;
  await page.goto('/ssbj');
  await page.getByTestId('fiscal-year-menu').click();
  await page.getByRole('option', { name: new RegExp(`^${FISCAL_YEAR_LABEL}`) }).click();
  await page.getByRole('button', { name: '新規作成' }).click();
  await page.getByRole('dialog').getByLabel(/レポート名/).fill(TITLE);
  await page.getByRole('dialog').getByRole('button', { name: '作成する' }).click();
  await expectToast(page, 'SSBJレポートを作成しました');
  await page.getByRole('link', { name: TITLE }).click();
  await page.waitForURL(/\/ssbj\/[0-9a-f-]{36}$/);
  reportId = page.url().split('/').pop()!;
  fiscalYearId = (await admin.client.from('ssbj_reports').select('fiscalYearId').eq('id', reportId).single()).data!.fiscalYearId as string;

  await adoptOnScreen(page);
  await expect(page.getByText(/採用済み（/)).toBeVisible();

  const { data, error } = await editor.client.from('ssbj_evidence')
    .insert({ organizationId, reportId, itemId: 'metrics_targets.ghg_emissions', documentTitle: EVIDENCE_TITLE, ownerDepartment: '環境部（E2E）' })
    .select('id').single();
  expect(error).toBeNull();
  evidenceId = data!.id as string;
});

test('2. 権限（画面）: 承認担当には編集の操作が出ず、閲覧者には作業中のレポートも内容も見えない', async () => {
  for (const path of ['/narratives', '/external']) {
    await approver.page.goto(reportPath(path));
    await expect(approver.page.getByTestId('ssbj-role-notice')).toBeVisible();
  }
  await expect(approver.page.getByRole('button', { name: '外部算定値を追加' })).toHaveCount(0);
  await approver.page.goto(reportPath('/narratives'));
  // ロールを読み込む前は編集の操作を出さないので、ロールの案内（承認担当）が出てから「無いこと」を確かめる。
  await expect(approver.page.getByTestId('ssbj-role-notice')).toContainText('承認担当');
  await expect(approver.page.getByTestId('ssbj-narrative-item').first()).toBeVisible();
  await expect(approver.page.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);

  // 入力担当には出る「新規作成」が、閲覧者には出ない（ロールの読み込みが終わってから確かめる）。
  await editor.page.goto('/ssbj');
  await expect(editor.page.getByRole('button', { name: '新規作成' })).toBeVisible();
  await viewer.page.goto('/ssbj');
  await viewer.page.waitForLoadState('networkidle');
  await expect(viewer.page.getByRole('button', { name: '新規作成' })).toHaveCount(0);
  await viewer.page.goto(reportPath());
  await expect(viewer.page.getByText('SSBJレポートが見つかりません').first()).toBeVisible();
  for (const path of ['/external', '/narratives', '/history']) {
    await viewer.page.goto(reportPath(path));
    await expect(viewer.page.getByTestId('ssbj-working-access-denied')).toBeVisible();
  }
});

test('3. 権限（API）: service_role を使う API は、ロールに合わない操作を 403 で拒否する', async () => {
  const { draftRevision } = await reportRow();
  const forbidden = async (response: Promise<import('@playwright/test').APIResponse>, message: string) => {
    const result = await response;
    expect(result.status(), message).toBe(403);
    expect((await result.json()).error, message).toContain('SSBJ のロールが');
  };
  const api = (path: string) => `/api/ssbj/reports/${reportId}${path}`;
  const anyVersionId = '00000000-0000-4000-8000-000000000000';

  await forbidden(approver.page.request.post(api('/versions'), { data: { expectedDraftRevision: draftRevision } }), '承認担当の保存版の作成');
  await forbidden(approver.page.request.post(api('/ogt-adoption'), { data: { expectedFingerprint: '0123456789abcdef' } }), '承認担当の採用');
  await forbidden(approver.page.request.post(api(`/versions/${anyVersionId}/restore`), { data: { expectedDraftRevision: draftRevision } }), '承認担当の復元');
  await forbidden(approver.page.request.post(api('/status'), { data: { action: 'submit', expectedDraftRevision: draftRevision } }), '承認担当のレビュー依頼');
  await forbidden(viewer.page.request.get(api('/preview')), '閲覧者の作業中のプレビュー');
  await forbidden(viewer.page.request.post(api('/status'), { data: { action: 'submit', expectedDraftRevision: draftRevision } }), '閲覧者のレビュー依頼');
  await forbidden(editor.page.request.post(api('/status'), { data: { action: 'approve', expectedDraftRevision: draftRevision } }), '入力担当の承認');
  expect((await reportRow()).draftRevision).toBe(draftRevision);
});

test('4. 権限（PostgREST の直接呼び出し）: 画面を通さずに書いても読んでも、DB がロールで止める', async () => {
  const before = await reportRow();
  // 承認担当: 作業中データを書けない（insert は拒否、update・delete は対象の行が無いものとして 0 件）。
  const insert = await approver.client.from('ssbj_external_emissions').insert(externalRow({ gases: ['SF6'] }));
  expect(insert.error?.code).toBe('42501');
  const narrative = await approver.client.from('ssbj_narratives')
    .insert({ organizationId, reportId, itemId: 'governance.oversight_body', disclosureState: 'unanswered' });
  expect(narrative.error?.code).toBe('42501');
  const rename = await approver.client.from('ssbj_reports').update({ title: '書き換え' }).eq('id', reportId).select('id');
  expect(rename.data).toEqual([]);
  const unadopt = await approver.client.from('ssbj_ogt_adoptions').delete().eq('reportId', reportId).select('id');
  expect(unadopt.data).toEqual([]);
  expect((await reportRow()).title).toBe(before.title);
  expect((await admin.client.from('ssbj_ogt_adoptions').select('id').eq('reportId', reportId)).data).toHaveLength(1);

  // 閲覧者: 承認前のレポート・作業中データ・操作履歴は見えず、レポートも作れない。
  for (const table of ['ssbj_reports', 'ssbj_report_versions', 'ssbj_external_emissions', 'ssbj_evidence', 'ssbj_audit_logs', 'ssbj_ogt_adoptions']) {
    const column = table === 'ssbj_reports' ? 'id' : 'reportId';
    const { data, error } = await viewer.client.from(table).select('*').eq(column, reportId);
    expect(error, table).toBeNull();
    expect(data, table).toEqual([]);
  }
  const create = await viewer.client.from('ssbj_reports').insert({ organizationId, fiscalYearId, title: `${SSBJ_E2E_TITLE_PREFIX} 閲覧者` });
  expect(create.error?.code).toBe('42501');

  // 入力担当: ロールの割り当て（管理者だけ）を自分で変えられない。割り当てに使う列は書けるので、拒否は管理者だけのポリシーによる。
  const promote = await editor.client.from('ssbj_member_roles')
    .insert({ organizationId, userId: editor.userId, role: 'approver' });
  expect(promote.error?.code).toBe('42501');
  const demote = await editor.client.from('ssbj_member_roles').update({ role: 'editor' }).eq('userId', approver.userId).select('userId');
  expect(demote.data).toEqual([]);
  expect((await reportRow()).draftRevision).toBe(before.draftRevision);

  // SSBJ のロールのテーブルが、OGT 本体の画面の問い合わせ（ログイン中の利用者と組織名。CurrentUserContext）を壊さない。
  // 組織・利用者の列を主キーにすると、PostgREST が profiles ↔ organizations の中間テーブルとみなし、埋め込みが PGRST201 で失敗する。
  const current = await admin.client.from('profiles').select('id, organizationId, role, organizations(name)').eq('id', admin.userId).maybeSingle();
  expect(current.error).toBeNull();
  expect(current.data?.organizations).toBeTruthy();
});

test('5. 数値（二重計上の防止）: OGT の採用値と重なる外部算定値は、画面からも直接の書き込みからも登録できない', async () => {
  const { page } = editor;
  await page.goto(reportPath('/external'));
  await page.getByRole('button', { name: '外部算定値を追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#external-scope').selectOption('1');
  await dialog.getByLabel('CO2', { exact: true }).click();
  await dialog.locator('#external-value').fill(EXTERNAL_VALUE);
  await dialog.locator('#external-calculated-by').fill(CALCULATED_BY);
  await dialog.locator('#external-method').fill('燃料の使用量に排出係数と GWP を掛けて算定（E2E）');
  await dialog.locator('#external-evidence').selectOption(evidenceId);
  await dialog.locator('#external-confirmed-by').selectOption({ label: '環境 太郎' });
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog.getByRole('alert')).toContainText(OVERLAP_WITH_OGT);
  expect((await editor.client.from('ssbj_external_emissions').select('id').eq('reportId', reportId)).data).toEqual([]);

  // CO2 を外し、OGT が算定していない CH4・N2O にすると登録できる。
  await dialog.getByLabel('CO2', { exact: true }).click();
  await dialog.getByLabel('CH4', { exact: true }).click();
  await dialog.getByLabel('N2O', { exact: true }).click();
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('ssbj-external-emission')).toHaveCount(1);
  const { data: rows } = await editor.client.from('ssbj_external_emissions').select('id, value, gases').eq('reportId', reportId);
  expect(rows).toHaveLength(1);
  externalId = rows![0].id as string;

  // 画面を通さずに書いても、同じ規則で DB が止める。
  const co2 = await editor.client.from('ssbj_external_emissions').insert(externalRow({ gases: ['CO2'] }));
  expect(co2.error?.code).toBe('P2071');
  const sameGas = await editor.client.from('ssbj_external_emissions').insert(externalRow({ gases: ['N2O', 'SF6'] }));
  expect(sameGas.error?.code).toBe('P2072');
  expect((await editor.client.from('ssbj_external_emissions').select('id').eq('reportId', reportId)).data).toHaveLength(1);
});

test('6. 数値（逆向き）: CO2 を含む外部算定値があるうちは、同じ Scope の OGT の値を採用できない', async () => {
  const { page } = editor;
  await page.goto(reportPath('/ghg'));
  await page.getByRole('button', { name: '採用を取り消す' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取り消す', exact: true }).click();
  await expect(page.getByRole('button', { name: '表示中の候補値を採用する' })).toBeVisible();

  const { data, error } = await editor.client.from('ssbj_external_emissions')
    .insert(externalRow({ gases: ['CO2'], calculatedBy: `子会社 A（E2E ${RUN}）` })).select('id').single();
  expect(error).toBeNull();

  await adoptOnScreen(page);
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('二重に計上されます');
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
  expect((await editor.client.from('ssbj_ogt_adoptions').select('id').eq('reportId', reportId)).data).toEqual([]);

  // 外部算定値の CO2 を消せば、採用できる。
  expect((await editor.client.from('ssbj_external_emissions').delete().eq('id', data!.id).select('id')).data).toHaveLength(1);
  await adoptOnScreen(page);
  await expect(page.getByText(/採用済み（/)).toBeVisible();
});

test('7. 数値（出力）: 保存版・CSV・印刷で、値は出典ごとに 1 回だけ出て、OGT の値に外部算定値を足さない', async () => {
  const { page } = editor;
  await page.goto(reportPath());
  await page.getByRole('button', { name: '保存版を作成' }).click();
  await expectToast(page, '版 1 として保存しました');
  [version1] = await versionsOfReport();
  const { ghg, external_emissions: external } = version1.snapshot.sections;
  expect(external).toHaveLength(1);
  const [item] = external as SsbjExternalEmissionSnapshot[];
  expect(item).toMatchObject({ id: externalId, scope: 1, gases: ['CH4', 'N2O'], value: EXTERNAL_VALUE, evidenceId });

  // 二重計上が無い: CO2 を含む外部算定値と同じ区分の OGT の採用値は、算定済みではない（Scope 2 は同じ基準の合計。R2-23）。
  for (const value of external!) {
    if (!value.gases.includes('CO2')) continue;
    if (value.scope === 2) {
      const scope2 = ghg!.values.find(adopted => adopted.scope === 2);
      const totals = scope2?.scope === 2 ? scope2.method.basisTotals : undefined;
      const total = value.scope2Basis === 'location' ? totals?.locationBased : totals?.marketBased;
      expect(total?.state, `2-${value.scope2Basis}`).not.toBe('answered');
      continue;
    }
    const ogt = ghg!.values.find(adopted => adopted.scope === value.scope && adopted.scope3CategoryId === value.scope3CategoryId);
    expect(ogt?.value.state, `${value.scope}-${value.scope3CategoryId}`).not.toBe('answered');
  }

  const csv = await downloadVersionCsv(page, 1);
  const ogtRows = csv.filter(row => row[COLUMN.group] === OGT_GROUP && row[COLUMN.item] !== '採用日時');
  // Scope 2 は、基準の区別のない値の行に加えて、基準別の 2 行（ロケーション基準・マーケット基準）が出る（R2-23）。
  const scope2Adopted = ghg!.values.find(value => value.scope === 2);
  const basisRowCount = scope2Adopted?.scope === 2 && scope2Adopted.method.basisTotals ? 2 : 0;
  expect(ogtRows).toHaveLength(ghg!.values.length + basisRowCount);
  expect(ogtRows.filter(row => row[COLUMN.target].startsWith('scope2.')).every(row => row[COLUMN.note].startsWith('出典: OGT 算定値'))).toBe(true);
  for (const value of ghg!.values) {
    const [row] = ogtRows.filter(candidate => candidate[COLUMN.target] === ogtValueKey(value));
    expect(row[COLUMN.note], ogtValueKey(value)).toMatch(/^出典: OGT 算定値/);
    expect(row[COLUMN.disclosure], ogtValueKey(value)).toBe(value.value.state === 'answered' ? value.value.value : '');
  }
  const externalRows = csv.filter(row => row[COLUMN.group] === EXTERNAL_GROUP);
  expect(externalRows.every(row => row[COLUMN.note].startsWith(`出典: 外部算定値（ID: ${externalId}）`))).toBe(true);
  const valueRows = externalRows.filter(row => row[COLUMN.disclosure] !== '');
  expect(valueRows).toEqual([expect.arrayContaining([EXTERNAL_GROUP, externalId, 'Scope 1（CH4・N2O）', '入力済み', EXTERNAL_VALUE, 't-CO2e'])]);

  // OGT の Scope 1 は採用した値のまま（外部算定値を足していない）。
  const scope1 = ghg!.values.find(value => value.scope === 1)!;
  const scope1Row = ogtRows.find(row => row[COLUMN.target] === ogtValueKey(scope1))!;
  expect(scope1.value.state).toBe('answered');
  if (scope1.value.state === 'answered') {
    expect(scope1Row[COLUMN.disclosure]).toBe(scope1.value.value);
    expect(scope1Row[COLUMN.disclosure]).not.toBe(addDecimals([scope1.value.value, EXTERNAL_VALUE]));
  }

  const print = await openPrintView(editor, version1.id);
  await expect(print.locator('body')).toContainText('出典: OGT 算定値');
  const section = print.getByTestId('ssbj-preview-external-emissions');
  await expect(section).toContainText('出典: 外部算定値');
  await expect(section).toContainText(`${EXTERNAL_VALUE} t-CO2e`);
  await print.close();
});

test('8. 根拠: 外部算定値から、根拠文書・算定した者・確認者と、誰が登録したかを辿れる', async () => {
  const csv = await downloadVersionCsv(editor.page, 1);
  const details = Object.fromEntries(csv
    .filter(row => row[COLUMN.group] === EXTERNAL_GROUP && row[COLUMN.target] === externalId && row[COLUMN.disclosure] === '')
    .map(row => [row[COLUMN.item], row[COLUMN.internal]]));
  expect(details).toMatchObject({ 根拠文書: EVIDENCE_TITLE, 算定した者: CALCULATED_BY, 確認者: '環境 太郎' });

  // 出典の詳細は内部記録: 画面のプレビューで「内部メモも表示する」を選んだときだけ出て、印刷・PDF には出ない
  // （URL に internal=1 を付けても出ない）。
  for (const extraQuery of ['', '&internal=1']) {
    const print = await openPrintView(editor, version1!.id, extraQuery);
    await expect(print.getByTestId('ssbj-preview-external-emissions')).toContainText('出典: 外部算定値');
    await expect(print.locator('body')).not.toContainText(CALCULATED_BY);
    await expect(print.locator('body')).not.toContainText(EVIDENCE_TITLE);
    await print.close();
  }
  const section = await openPreviewWithInternalNotes(editor, version1!.id);
  await expect(section).toContainText(CALCULATED_BY);
  await expect(section).toContainText(`根拠文書: ${EVIDENCE_TITLE}`);

  // 根拠文書の画面で、同じ資料に辿り着ける。外部算定値が参照している間は消せない。
  await editor.page.goto(reportPath('/evidence'));
  await expect(editor.page.getByText(EVIDENCE_TITLE)).toBeVisible();
  const remove = await editor.client.from('ssbj_evidence').delete().eq('id', evidenceId);
  expect(remove.error?.code).toBe('23503');

  await editor.page.goto(reportPath('/history'));
  const rows = editor.page.getByTestId('ssbj-audit-row').filter({ hasText: `外部算定値: ${CALCULATED_BY}` });
  await expect(rows.first()).toContainText('算定 花子');
});

test('9. 承認: レビューを依頼した本人は承認できず、指定された承認担当が承認すると作業中の内容が変えられなくなる', async () => {
  await admin.page.goto(reportPath());
  await admin.page.locator('#ssbj-status-approver').selectOption({ label: '確認 三郎' });
  await admin.page.getByRole('button', { name: 'レビューを依頼する' }).click();
  await expectToast(admin.page, 'レビューを依頼しました');

  const own = await admin.page.request.post(`/api/ssbj/reports/${reportId}/status`, {
    data: { action: 'approve', expectedDraftRevision: (await reportRow()).draftRevision },
  });
  expect(own.status()).toBe(403);
  expect((await own.json()).error).toContain('レビューを依頼した本人は承認できません');
  expect((await reportRow()).status).toBe('in_review');

  await approver.page.goto(reportPath());
  await approver.page.getByRole('button', { name: '承認する' }).click();
  await expectToast(approver.page, /承認しました/);
  const row = await reportRow();
  expect(row.status).toBe('approved');
  approvedVersionId = row.approvedVersionId!;

  const locked = await editor.client.from('ssbj_external_emissions').update({ value: EXTERNAL_VALUE_CHANGED }).eq('id', externalId).select('id');
  expect(locked.error?.code).toBe('P2051');
});

test('10. 閲覧者は、承認したレポートの承認した版の開示する内容だけを見て出力できる（内部メモ・内部記録は受け取らない）', async () => {
  const { data: reports } = await viewer.client.from('ssbj_reports').select('id').eq('id', reportId);
  expect(reports).toHaveLength(1);
  // 保存版の行は、承認した版も含めて読めない（内部記録を含むため）。承認した版は、内部記録を除いて API が返す。
  expect(await versionsOfReport(viewer.client)).toEqual([]);
  expect((await viewer.client.from('ssbj_external_emissions').select('id').eq('reportId', reportId)).data).toEqual([]);
  const api = await viewer.page.request.get(`/api/ssbj/reports/${reportId}/approved-version`);
  expect(api.status()).toBe(200);
  const body = await api.text();
  expect((JSON.parse(body) as { id: string }).id).toBe(approvedVersionId);
  expect(body).toContain(EXTERNAL_VALUE);
  for (const internal of [CALCULATED_BY, EVIDENCE_TITLE]) expect(body).not.toContain(internal);

  const approved = await viewer.client.rpc('record_ssbj_export', { p_report_id: reportId, p_format: 'csv', p_version_id: approvedVersionId });
  expect(approved.error).toBeNull();
  const other = await viewer.client.rpc('record_ssbj_export', { p_report_id: reportId, p_format: 'csv', p_version_id: version1!.id });
  expect(other.error).not.toBeNull();

  await viewer.page.goto(reportPath('/preview'));
  await expect(viewer.page.getByTestId('ssbj-preview-source')).toContainText('保存版 第2版');
  await expect(viewer.page.getByTestId('ssbj-preview-external-emissions')).toContainText('出典: 外部算定値');
  await expect(viewer.page.getByLabel('内部メモも表示する（開示しない内容）')).toHaveCount(0);
  await expect(viewer.page.getByRole('article')).not.toContainText(CALCULATED_BY);

  // CSV には内部記録の列が無く、内部記録も入らない。操作履歴へのリンクも出ない。
  const csv = await downloadVersionCsv(viewer.page, 2);
  expect(csv.find(row => row[0] === '章')).toEqual(['章', '対象ID', '項目', '状態', '開示内容', '単位', '注記']);
  expect(csv.flat().some(cell => cell.includes(CALCULATED_BY) || cell.includes(EVIDENCE_TITLE))).toBe(false);
  await expect(viewer.page.getByRole('link', { name: '操作履歴を見る' })).toHaveCount(0);
});

test('11. 承認した内容は、差戻した後に元データ・根拠・拠点名を変えても、保存版のまま変わらない', async () => {
  const [before] = (await versionsOfReport()).filter(version => version.id === approvedVersionId);
  const csvBefore = await downloadVersionCsv(admin.page, before.versionNumber);

  const reopen = await admin.page.request.post(`/api/ssbj/reports/${reportId}/status`, {
    data: { action: 'reopen', expectedDraftRevision: (await reportRow()).draftRevision, comment: `外部算定値を見直す（E2E ${RUN}）` },
  });
  expect(reopen.status()).toBe(200);

  // 根拠と外部算定値（作業中の内容）を変える。
  expect((await editor.client.from('ssbj_evidence').update({ documentTitle: EVIDENCE_TITLE_CHANGED }).eq('id', evidenceId).select('id')).data).toHaveLength(1);
  expect((await editor.client.from('ssbj_external_emissions').update({ value: EXTERNAL_VALUE_CHANGED }).eq('id', externalId).select('id')).data).toHaveLength(1);

  // OGT の元データ（Scope 3 の直接入力）と拠点名を変える（終わったら必ず戻す）。
  const { data: direct } = await admin.client.from('scope3_category_emissions').select('id, emissions')
    .eq('fiscalYearId', fiscalYearId).order('categoryId', { ascending: false }).limit(1).single();
  const { data: location } = await admin.client.from('locations').select('id, name').eq('organizationId', organizationId).order('name').limit(1).single();
  await rememberScope3DirectValue({ id: direct!.id as string, emissions: String(direct!.emissions) });
  await rememberLocationName({ id: location!.id as string, name: location!.name as string });
  try {
    const changedDirect = await admin.client.from('scope3_category_emissions')
      .update({ emissions: addDecimals([String(direct!.emissions), '1']) }).eq('id', direct!.id).select('id');
    expect(changedDirect.data).toHaveLength(1);
    const renamed = await admin.client.from('locations').update({ name: `${location!.name}（E2E ${RUN}）` }).eq('id', location!.id).select('id');
    expect(renamed.data).toHaveLength(1);

    // 承認した版の内容・CSV は変わらない。
    const [after] = (await versionsOfReport()).filter(version => version.id === approvedVersionId);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(await downloadVersionCsv(admin.page, before.versionNumber)).toEqual(csvBefore);

    // 承認した版は保存した時点の根拠と値、作業中の内容は変えた後の根拠と値を出す（根拠は内部記録なので画面のプレビューで確かめる）。
    const approvedPrint = await openPrintView(admin, approvedVersionId);
    await expect(approvedPrint.getByTestId('ssbj-preview-external-emissions')).toContainText(`${EXTERNAL_VALUE} t-CO2e`);
    await approvedPrint.close();
    const approvedSection = await openPreviewWithInternalNotes(admin, approvedVersionId);
    await expect(approvedSection).toContainText(`根拠文書: ${EVIDENCE_TITLE}`);
    await expect(approvedSection).toContainText(`${EXTERNAL_VALUE} t-CO2e`);
    await expect(approvedSection).not.toContainText(EVIDENCE_TITLE_CHANGED);
    const workingSection = await openPreviewWithInternalNotes(admin, 'working');
    await expect(workingSection).toContainText(EVIDENCE_TITLE_CHANGED);
    await expect(workingSection).toContainText(`${EXTERNAL_VALUE_CHANGED} t-CO2e`);
  } finally {
    await restoreScope3DirectValue();
    await restoreLocationName();
  }
});
