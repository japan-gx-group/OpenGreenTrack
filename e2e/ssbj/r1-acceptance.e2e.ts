// SSBJ 開示レポート（試行版 R1）の全体テスト。実画面と実データ（ローカル Supabase のデモシード）で、
// 作成 → 文章 → リスク・機会 → OGT 採用 → 判断 → 根拠 → 保存 → 履歴 → プレビュー → CSV を 1 本の流れで通し、
// 続けて境界条件（二重加算・元データ更新後の保存版の維持・同時保存・他組織・欠損と 0）を確かめる。
// 前の手順が作ったレポートを次の手順が使うため、手順は順番に実行する（1 つ失敗したら以降は飛ばす）。

import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OgtAdoptedValue, OgtSupplierReference, SsbjReportSnapshotV1 } from '../../src/features/ssbj/types';
import { ogtValueKey } from '../../src/features/ssbj/utils/ogtValue';
import {
  FISCAL_YEAR_LABEL,
  ORG_A_USER,
  ORG_B_USER,
  SSBJ_E2E_TITLE_PREFIX,
  addDecimals,
  createUserClient,
  expectToast,
  parseSsbjCsv,
  rememberScope3DirectValue,
  restoreScope3DirectValue,
  sameDecimal,
  signIn,
} from './support';

test.describe.configure({ mode: 'serial' });

const RUN = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const TITLE = `${SSBJ_E2E_TITLE_PREFIX} R1 全体テスト ${RUN}`;

// 入力する内容。開示する内容と内部記録が出力で取り違えられていないかを見分けられるよう、すべて別の文にする。
const INPUT = {
  narrative: `取締役会が気候関連のリスク及び機会を監督している（E2E ${RUN}）。`,
  narrativeNote: `監督体制の文書化は確認中（E2E 内部メモ ${RUN}）。`,
  narrativeChanged: `取締役会とサステナビリティ委員会が監督している（E2E 変更後 ${RUN}）。`,
  riskTitle: `炭素価格の導入（E2E ${RUN}）`,
  riskDescription: `炭素価格が導入されると原材料の調達コストが上がる（E2E ${RUN}）。`,
  riskNote: `影響額は経営企画部で試算中（E2E 内部メモ ${RUN}）。`,
  judgement: `経過措置により Scope 3 のカテゴリー別の内訳を開示していない（E2E ${RUN}）。`,
  judgementNote: `Scope 3 の算定体制を整備中（E2E 内部理由 ${RUN}）。`,
  evidenceTitle: `取締役会議事録（E2E ${RUN}）`,
  evidenceDisclosure: `取締役会の開催記録に基づく（E2E ${RUN}）。`,
};
const DISCLOSED = [INPUT.narrative, INPUT.riskTitle, INPUT.riskDescription, INPUT.judgement, INPUT.evidenceDisclosure];
const INTERNAL = [INPUT.narrativeNote, INPUT.riskNote, INPUT.judgementNote, INPUT.evidenceTitle];

// CSV の列: 章 / 対象ID / 項目 / 状態 / 開示内容 / 単位 / 内部記録 / 注記
const COLUMN = { group: 0, target: 1, item: 2, state: 3, disclosure: 4, internal: 6, note: 7 } as const;

type AdoptionRow = { adoptedValues: OgtAdoptedValue[]; supplierReferences: OgtSupplierReference[] };

let context: BrowserContext;
let page: Page;
let orgA: SupabaseClient;
let reportId = '';
let fiscalYearId = '';
let version1: { id: string; snapshot: SsbjReportSnapshotV1 } | null = null;
let version1Csv: string[][] = [];

const reportPath = (path = '') => `/ssbj/${reportId}${path}`;

const versionsOfReport = async () => {
  const { data, error } = await orgA
    .from('ssbj_report_versions')
    .select('id, versionNumber, snapshot')
    .eq('reportId', reportId)
    .order('versionNumber');
  if (error) throw error;
  return (data ?? []) as { id: string; versionNumber: number; snapshot: SsbjReportSnapshotV1 }[];
};

const adoptionOfReport = async (): Promise<AdoptionRow[]> => {
  const { data, error } = await orgA
    .from('ssbj_ogt_adoptions')
    .select('adoptedValues, supplierReferences')
    .eq('reportId', reportId);
  if (error) throw error;
  return (data ?? []) as AdoptionRow[];
};

/** 保存履歴の画面から、指定の版の CSV を出力して読む。 */
const downloadVersionCsv = async (versionNumber: number): Promise<string[][]> => {
  await page.goto(reportPath('/versions'));
  const item = page.getByRole('listitem').filter({ has: page.getByText(`版 ${versionNumber}`, { exact: true }) });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    item.getByRole('button', { name: 'CSVを出力' }).click(),
  ]);
  return parseSsbjCsv(await readFile((await download.path())!));
};

/** 印刷ビュー（PDF と同じ内容）を、印刷ダイアログを出さずに開く。 */
const openPrintView = async (source: string, internal: boolean): Promise<Page> => {
  const print = await context.newPage();
  await print.addInitScript(() => { window.print = () => undefined; });
  await print.goto(reportPath(`/preview/print?source=${source}&internal=${internal ? '1' : '0'}`));
  await expect(print.getByTestId('ssbj-preview-source')).toBeVisible();
  return print;
};

const editNarrative = async (label: string, disclosure: string, internalNote?: string) => {
  await page.goto(reportPath('/narratives'));
  const card = page.getByTestId('ssbj-narrative-item').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  await card.getByRole('button', { name: '編集' }).click();
  await card.getByLabel('開示する文章の状態').selectOption('answered');
  await card.getByLabel('開示する文章', { exact: true }).fill(disclosure);
  if (internalNote !== undefined) await card.getByLabel('内部メモ（開示しない）').fill(internalNote);
  await card.getByRole('button', { name: '保存', exact: true }).click();
  await expect(card).toContainText(disclosure);
};

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  orgA = await createUserClient(ORG_A_USER);
  await signIn(page, ORG_A_USER);
});

test.afterAll(async () => {
  await context?.close();
});

test('1. レポートを作成する（選択中の年度に作られる）', async () => {
  await page.goto('/ssbj');
  await page.getByTestId('fiscal-year-menu').click();
  await page.getByRole('option', { name: new RegExp(`^${FISCAL_YEAR_LABEL}`) }).click();
  await page.getByRole('button', { name: '新規作成' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/レポート名/).fill(TITLE);
  await dialog.getByRole('button', { name: '作成する' }).click();
  await expectToast(page, 'SSBJレポートを作成しました');
  await page.getByRole('link', { name: TITLE }).click();
  await page.waitForURL(/\/ssbj\/[0-9a-f-]{36}$/);
  reportId = page.url().split('/').pop()!;

  const { data, error } = await orgA.from('ssbj_reports').select('fiscalYearId, draftRevision').eq('id', reportId).single();
  expect(error).toBeNull();
  fiscalYearId = data!.fiscalYearId as string;
  await expect(page.getByText(FISCAL_YEAR_LABEL).first()).toBeVisible();
});

test('2. 四本柱の文章を書く（開示する文章と内部メモを分けて保存する）', async () => {
  await editNarrative('監督する機関・責任者', INPUT.narrative, INPUT.narrativeNote);
  await page.reload();
  const card = page.getByTestId('ssbj-narrative-item').filter({ has: page.getByRole('heading', { name: '監督する機関・責任者', exact: true }) });
  await expect(card).toContainText(INPUT.narrative);
  await expect(card).toContainText(INPUT.narrativeNote);
});

test('3. リスク・機会を登録する', async () => {
  await page.goto(reportPath('/risks'));
  await page.getByRole('button', { name: 'リスク・機会を追加' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/区分/).selectOption('risk');
  await dialog.getByLabel(/名称/).fill(INPUT.riskTitle);
  await dialog.getByLabel('説明（開示する文章）の状態').selectOption('answered');
  await dialog.getByLabel('説明（開示する文章）', { exact: true }).fill(INPUT.riskDescription);
  await dialog.getByLabel('内部メモ（開示しない）').fill(INPUT.riskNote);
  await dialog.getByRole('button', { name: '登録する' }).click();
  await expect(page.getByTestId('ssbj-risk-opportunity').filter({ hasText: INPUT.riskTitle })).toContainText(INPUT.riskDescription);
});

test('4. OGT の値をレポートに採用する', async () => {
  await page.goto(reportPath('/ghg'));
  await page.getByRole('button', { name: '表示中の候補値を採用する' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '採用する', exact: true }).click();
  await expect(page.getByText(/採用済み（/)).toBeVisible();
  const adoptions = await adoptionOfReport();
  expect(adoptions).toHaveLength(1);
  expect(adoptions[0].adoptedValues).toHaveLength(18);
});

test('5. 該当性・重要性・記載しない理由を記録する', async () => {
  await page.goto(reportPath('/judgements'));
  const row = page.getByTestId('ssbj-judgement-row').filter({ hasText: 'REQ-CLM-020' });
  await row.getByRole('button', { name: '編集' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('該当性').selectOption('applicable');
  await dialog.getByLabel('重要性', { exact: true }).selectOption('material');
  await dialog.getByLabel('記載しない理由').selectOption('transition_relief');
  await dialog.getByLabel('開示する説明の状態').selectOption('answered');
  await dialog.getByLabel('開示する説明', { exact: true }).fill(INPUT.judgement);
  await dialog.getByLabel('内部の検討理由（開示しない）').fill(INPUT.judgementNote);
  await dialog.getByRole('button', { name: '変更を保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('経過措置を適用');
});

test('6. 根拠文書・主管部署を登録する', async () => {
  await page.goto(reportPath('/evidence'));
  await page.getByRole('button', { name: '根拠文書を追加' }).click();
  const dialog = page.getByRole('dialog');
  // この画面の選択欄は Radix のセレクト（選択肢はダイアログの外に出る）。
  await dialog.locator('#evidence-section').click();
  await page.getByRole('option', { name: 'ガバナンス', exact: true }).click();
  await dialog.locator('#evidence-slug').fill('oversight_body');
  await dialog.locator('#evidence-title').fill(INPUT.evidenceTitle);
  await dialog.locator('#evidence-department').fill('総務部（E2E）');
  await dialog.locator('#evidence-state').click();
  await page.getByRole('option', { name: '入力済み', exact: true }).click();
  await dialog.locator('#evidence-disclosure').fill(INPUT.evidenceDisclosure);
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(INPUT.evidenceTitle)).toBeVisible();
});

test('7. 画面を開き直しても、入力した内容がそのまま再表示される', async () => {
  await page.goto(reportPath('/risks'));
  const risk = page.getByTestId('ssbj-risk-opportunity').filter({ hasText: INPUT.riskTitle });
  await expect(risk).toContainText(INPUT.riskDescription);
  await expect(risk).toContainText(INPUT.riskNote);

  await page.goto(reportPath('/judgements'));
  const judgement = page.getByTestId('ssbj-judgement-row').filter({ hasText: 'REQ-CLM-020' });
  await expect(judgement).toContainText('経過措置を適用');
  await expect(judgement).toContainText(INPUT.judgement);

  await page.goto(reportPath('/evidence'));
  await expect(page.getByText(INPUT.evidenceTitle)).toBeVisible();
  await expect(page.getByText(INPUT.evidenceDisclosure)).toBeVisible();

  await page.goto(reportPath('/ghg'));
  await expect(page.getByText(/採用済み（/)).toBeVisible();

  await page.goto(reportPath());
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible();
});

test('8. 保存版を作る', async () => {
  await page.goto(reportPath());
  await page.getByRole('button', { name: '保存版を作成' }).click();
  await expectToast(page, '版 1 として保存しました');
  const versions = await versionsOfReport();
  expect(versions.map(version => version.versionNumber)).toEqual([1]);
  version1 = versions[0];
  expect(Object.keys(version1.snapshot.sections).sort())
    .toEqual(['evidence', 'ghg', 'judgements', 'narratives', 'risks_opportunities', 'time_horizons']);
});

test('9. 保存履歴で内容を確かめ、その版の CSV に入力が欠落なく出る', async () => {
  await page.goto(reportPath('/versions'));
  await page.getByRole('button', { name: '内容を見る' }).first().click();
  await expect(page.getByText(/の保存内容/)).toBeVisible();

  version1Csv = await downloadVersionCsv(1);
  expect(version1Csv).toContainEqual(['版ID', version1!.id]);
  const disclosed = version1Csv.map(row => row[COLUMN.disclosure]);
  const internal = version1Csv.map(row => row[COLUMN.internal]);
  expect(DISCLOSED.filter(text => !disclosed.includes(text))).toEqual([]);
  expect(INTERNAL.filter(text => !internal.includes(text))).toEqual([]);
  // 内部記録を開示内容の列に混ぜない。
  expect(INTERNAL.filter(text => disclosed.includes(text))).toEqual([]);

  // GHG: 保存版の採用値がすべて 1 行ずつ出る。
  const ghg = version1!.snapshot.sections.ghg!;
  for (const value of ghg.values) {
    const rows = version1Csv.filter(row => row[COLUMN.group] === 'GHG排出量' && row[COLUMN.target] === ogtValueKey(value));
    expect(rows, ogtValueKey(value)).toHaveLength(1);
    expect(rows[0][COLUMN.disclosure]).toBe(value.value.state === 'answered' ? value.value.value : '');
  }
});

test('10. プレビュー（作業中・保存版）に入力が出て、内部記録は選んだときだけ出る', async () => {
  await page.goto(reportPath('/preview'));
  await expect(page.getByTestId('ssbj-preview-source')).toContainText('作業中の内容');
  const preview = page.getByRole('article');
  for (const text of DISCLOSED) await expect(preview).toContainText(text);
  for (const text of INTERNAL) await expect(preview).not.toContainText(text);
  await expect(preview).not.toContainText('プレビューに表示していない項目');
  await page.getByLabel('内部メモも表示する（開示しない内容）').click();
  for (const text of INTERNAL) await expect(preview).toContainText(text);

  const print = await openPrintView(version1!.id, false);
  await expect(print.getByTestId('ssbj-preview-source')).toContainText('保存版 第1版');
  for (const text of DISCLOSED) await expect(print.locator('body')).toContainText(text);
  for (const text of INTERNAL) await expect(print.locator('body')).not.toContainText(text);
  await print.close();
});

test('11. 二重加算が無い（採用し直しても 1 件、サプライヤー別の値は合計に足さない）', async () => {
  await page.goto(reportPath('/ghg'));
  await page.getByRole('button', { name: '表示中の候補値で採用し直す' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '採用する', exact: true }).click();
  await expect(page.getByText(/採用済み（/)).toBeVisible();

  const adoptions = await adoptionOfReport();
  expect(adoptions).toHaveLength(1);
  const { adoptedValues, supplierReferences } = adoptions[0];
  const keys = adoptedValues.map(ogtValueKey);
  expect(new Set(keys).size).toBe(18);

  // Scope 3 の合計は、カテゴリ別の採用値の合計と一致し、サプライヤー別の参考値を含まない。
  const scope3Total = adoptedValues.find(value => value.scope === 3 && value.scope3CategoryId === null)!;
  const categories = adoptedValues.filter(value => value.scope === 3 && value.scope3CategoryId !== null);
  const categorySum = addDecimals(categories.flatMap(value => (value.value.state === 'answered' ? [value.value.value] : [])));
  expect(scope3Total.value.state).toBe('answered');
  if (scope3Total.value.state === 'answered') {
    expect(sameDecimal(scope3Total.value.value, categorySum), `Scope 3 合計 ${scope3Total.value.value} / カテゴリ合計 ${categorySum}`).toBe(true);
    const supplierSum = addDecimals(supplierReferences.map(supplier => supplier.emissions));
    expect(supplierReferences.length).toBeGreaterThan(0);
    expect(sameDecimal(scope3Total.value.value, addDecimals([categorySum, supplierSum]))).toBe(false);
  }

  // 保存版の CSV でも、採用値は 1 区分 1 行で、参考値は別の章に分かれている。
  const adoptedRows = version1Csv.filter(row => row[COLUMN.group] === 'GHG排出量' && row[COLUMN.item] !== '採用日時');
  expect(adoptedRows).toHaveLength(18);
  expect(version1Csv.filter(row => row[COLUMN.group] === 'GHG排出量（参考値）'))
    .toHaveLength(version1!.snapshot.sections.ghg!.supplierReferences.length);
});

test('12. 元データ（作業中の文章・OGT の値）を変えても、保存版は保存した時点のまま', async () => {
  await editNarrative('監督する機関・責任者', INPUT.narrativeChanged);

  // OGT の Scope 3 の直接入力を 1 件だけ一時的に変える（終わったら必ず元に戻す）。
  const { data: direct, error } = await orgA
    .from('scope3_category_emissions')
    .select('id, categoryId, emissions')
    .eq('fiscalYearId', fiscalYearId)
    .order('categoryId', { ascending: false })
    .limit(1)
    .single();
  expect(error).toBeNull();
  const original = String(direct!.emissions);
  await rememberScope3DirectValue({ id: direct!.id as string, emissions: original });
  try {
    const { error: updateError } = await orgA
      .from('scope3_category_emissions')
      .update({ emissions: addDecimals([original, '1']) })
      .eq('id', direct!.id);
    expect(updateError).toBeNull();

    // OGT 側は変わったことを画面が知らせる（採用した値は自動では変わらない）。
    await page.goto(reportPath('/ghg'));
    await expect(page.getByText('採用した後で OGT の値が変わりました')).toBeVisible();

    // 保存版の中身は変わらない（DB の保存版・印刷ビュー・CSV）。
    const after = (await versionsOfReport()).find(version => version.id === version1!.id)!;
    expect(after.snapshot).toEqual(version1!.snapshot);
    const print = await openPrintView(version1!.id, false);
    await expect(print.locator('body')).toContainText(INPUT.narrative);
    await expect(print.locator('body')).not.toContainText(INPUT.narrativeChanged);
    await print.close();
    const csvAgain = await downloadVersionCsv(1);
    const withoutGeneratedAt = (rows: string[][]) => rows.filter(row => row[0] !== '生成日時');
    expect(withoutGeneratedAt(csvAgain)).toEqual(withoutGeneratedAt(version1Csv));

    // 作業中のプレビューには変更後の文章が出る。
    await page.goto(reportPath('/preview'));
    await expect(page.getByRole('article')).toContainText(INPUT.narrativeChanged);
  } finally {
    await restoreScope3DirectValue();
  }
  const { data: restored } = await orgA.from('scope3_category_emissions').select('emissions').eq('id', direct!.id).single();
  expect(sameDecimal(String(restored!.emissions), original)).toBe(true);
});

test('13. 同時保存: 読み込んだ後に別の画面で内容が変わったら、保存版の作成を競合として止める', async () => {
  const other = await context.newPage();
  await other.goto(reportPath());
  await expect(other.getByRole('button', { name: '保存版を作成' })).toBeEnabled();

  // 別の画面（page）で作業中の内容を変える。
  await editNarrative('経営者の役割', `管理本部長に委任している（E2E ${RUN}）。`);

  await other.getByRole('button', { name: '保存版を作成' }).click();
  await expect(other.getByRole('alert').filter({ hasText: '他の変更と競合しました' })).toBeVisible();
  expect((await versionsOfReport()).map(version => version.versionNumber)).toEqual([1]);

  // 開き直せば作れる。
  await other.reload();
  await other.getByRole('button', { name: '保存版を作成' }).click();
  await expectToast(other, '版 2 として保存しました');
  expect((await versionsOfReport()).map(version => version.versionNumber)).toEqual([1, 2]);
  await other.close();
});

test('14. 過去の版から新しい版を作る（作業中の内容は変えない）', async () => {
  await page.goto(reportPath('/versions'));
  const item = page.getByRole('listitem').filter({ has: page.getByText('版 1', { exact: true }) });
  await item.getByRole('button', { name: 'この版から新版を作成' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '新版を作成' }).click();
  await expect(page.getByText('版 3 を作成しました。作業中データは変更されていません。')).toBeVisible();

  const versions = await versionsOfReport();
  expect(versions.map(version => version.versionNumber)).toEqual([1, 2, 3]);
  const { data: copied } = await orgA.from('ssbj_report_versions').select('sourceVersionId, snapshot').eq('id', versions[2].id).single();
  expect(copied!.sourceVersionId).toBe(version1!.id);
  expect(copied!.snapshot).toEqual(version1!.snapshot);

  // 作業中の内容は、版 1 の内容に戻っていない（変更後の文章のまま）。
  await page.goto(reportPath('/preview'));
  await expect(page.getByRole('article')).toContainText(INPUT.narrativeChanged);
});

test('15. 他の組織からは、画面・API・DB のどこからも見えず、変えられない', async ({ browser }) => {
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await signIn(pageB, ORG_B_USER);
  for (const path of ['', '/narratives', '/risks', '/judgements', '/ghg', '/evidence', '/versions', '/preview']) {
    await pageB.goto(reportPath(path));
    await expect(pageB.getByText('SSBJレポートが見つかりません').first(), path || '詳細').toBeVisible();
    for (const text of [TITLE, ...DISCLOSED]) await expect(pageB.locator('body')).not.toContainText(text);
  }

  const preview = await pageB.request.get(`/api/ssbj/reports/${reportId}/preview`);
  expect(preview.status()).toBe(404);
  const version = await pageB.request.post(`/api/ssbj/reports/${reportId}/versions`, { data: { expectedDraftRevision: 1 } });
  expect(version.status()).toBe(404);
  const adoption = await pageB.request.post(`/api/ssbj/reports/${reportId}/ogt-adoption`, {
    data: { expectedFingerprint: '0123456789abcdef' },
  });
  expect(adoption.status()).toBe(404);
  await contextB.close();

  const orgB = await createUserClient(ORG_B_USER);
  const tables: [string, string][] = [
    ['ssbj_reports', 'id'],
    ['ssbj_report_versions', 'reportId'],
    ['ssbj_narratives', 'reportId'],
    ['ssbj_judgements', 'reportId'],
    ['ssbj_risks_opportunities', 'reportId'],
    ['ssbj_report_time_horizons', 'reportId'],
    ['ssbj_evidence', 'reportId'],
    ['ssbj_ogt_adoptions', 'reportId'],
  ];
  for (const [table, column] of tables) {
    const { data, error } = await orgB.from(table).select('*').eq(column, reportId);
    expect(error, table).toBeNull();
    expect(data, table).toEqual([]);
  }
  const { data: orgBProfile } = await orgB.from('profiles').select('organizationId').single();
  const { error: insertError } = await orgB.from('ssbj_narratives').insert({
    organizationId: orgBProfile!.organizationId,
    reportId,
    itemId: 'governance.management_role',
    disclosureState: 'answered',
    disclosureText: '他組織からの書き込み',
  });
  expect(insertError).not.toBeNull();
  const { error: rpcError } = await orgB.rpc('ssbj_build_report_snapshot', { p_report_id: reportId });
  expect(rpcError).not.toBeNull();

  // 組織 A のデータは変わっていない。
  expect((await versionsOfReport()).map(item => item.versionNumber)).toEqual([1, 2, 3]);
});

test('16. 欠損と 0 を区別する（入力の無い項目・未算定の値を 0 や空欄にしない）', async () => {
  const stateOf = (target: string, item?: string) =>
    version1Csv.find(row => row[COLUMN.target] === target && (item === undefined || row[COLUMN.item] === item));

  // 文章を書いていない項目は「未入力」、判断していない要求は「未確認」として出る（行が消えない）。
  expect(stateOf('governance.management_role')?.[COLUMN.state]).toBe('未入力');
  expect(stateOf('REQ-GEN-002', '該当性')?.slice(COLUMN.state, COLUMN.disclosure + 1)).toEqual(['未確認', '未確認']);

  // GHG: 算定値の無い区分は「未算定」で値は空。回答済みの値は 0 も含めてそのまま出る。
  const ghg = version1!.snapshot.sections.ghg!;
  const unanswered = ghg.values.filter(value => value.value.state !== 'answered');
  // デモシードの 2024 年度には、直接入力の無い Scope 3 カテゴリがある（ここが空なら確認になっていない）。
  expect(unanswered.length).toBeGreaterThan(0);
  for (const value of unanswered) {
    const row = version1Csv.find(item => item[COLUMN.group] === 'GHG排出量' && item[COLUMN.target] === ogtValueKey(value))!;
    expect(row.slice(COLUMN.state, COLUMN.disclosure + 1), ogtValueKey(value)).toEqual(['未算定', '']);
  }
  for (const value of ghg.values.filter(item => item.value.state === 'answered')) {
    const row = version1Csv.find(item => item[COLUMN.group] === 'GHG排出量' && item[COLUMN.target] === ogtValueKey(value))!;
    expect(row[COLUMN.state], ogtValueKey(value)).not.toBe('未算定');
  }
});
