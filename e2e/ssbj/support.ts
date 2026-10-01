// SSBJ 全体テスト（playwright.ssbj.config.ts）の共通処理: ログイン、Supabase クライアント、CSV の読み取り、後片付け。
//
// - 画面の操作と、組織分離の確認に使う Supabase クライアントは anon キー + デモユーザーのログイン（RLS の下）で動かす。
// - service_role キーは後片付け（テストが作ったレポートの削除）にだけ使う。SSBJ のレポートは利用者が削除できない
//   作りのため（保存版を消させない）。消すのはテスト用の目印で始まる名前のレポートだけで、保存版などは連鎖削除される。

import { existsSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type Page } from '@playwright/test';
import { assertLocalSupabaseUrl } from '../support/testDb';

/** テストが作るレポート名の先頭に付ける目印。後片付けはこの目印で探す。 */
export const SSBJ_E2E_TITLE_PREFIX = '[e2e-ssbj]';

type DemoUser = { email: string; password: string };

/** デモシード（supabase/seeds/demo/demo.sql）の組織 A（架空精密工業）の管理者。 */
export const ORG_A_USER: DemoUser = { email: 'org-a@example.com', password: 'password123' };
/** 別組織（架空ロジスティクス）の管理者。組織分離の確認に使う。 */
export const ORG_B_USER: DemoUser = { email: 'org-b@example.com', password: 'password123' };

/**
 * レポートを作る年度。デモシードでは組織 A の 2024 年度に OGT の算定値・Scope 3 の直接入力・
 * サプライヤー別排出量がそろっている（OGT の値の採用と、元データを変えたときの確認に使う）。
 */
export const FISCAL_YEAR_LABEL = '2024年度';

const supabaseUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です（.env.local を確認してください）');
  }
  assertLocalSupabaseUrl(url);
  return url;
};

/** デモユーザーでログインした Supabase クライアント（RLS の下で動く）。 */
export const createUserClient = async (user: DemoUser): Promise<SupabaseClient> => {
  const supabase = createClient(supabaseUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword(user);
  if (error) throw new Error(`${user.email} でログインできませんでした: ${error.message}（デモシードを確認してください）`);
  return supabase;
};

/** テストが作ったレポートを消す（目印で始まる名前のものだけ）。消した件数を返す。 */
export const deleteE2eReports = async (): Promise<number> => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('後片付けに SUPABASE_SERVICE_ROLE_KEY が必要です（.env.local を確認してください）');
  const admin = createClient(supabaseUrl(), serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin
    .from('ssbj_reports')
    .delete()
    .like('title', `${SSBJ_E2E_TITLE_PREFIX}%`)
    .select('id');
  if (error) throw new Error(`テスト用の SSBJ レポートを削除できませんでした: ${error.message}`);
  return data?.length ?? 0;
};

// 元データを一時的に変える手順（OGT の Scope 3 の直接入力）が、戻す前に中断されたときのための控え。
// 変える前に元の値を書き出し、戻したら消す。残っていれば次の実行の開始時・終了時に戻す。
const PENDING_RESTORE_FILE = path.join(tmpdir(), 'opengreentrack-e2e-ssbj-restore.json');

type Scope3DirectValue = { id: string; emissions: string };

/** 変える前の Scope 3 の直接入力の値を控える。 */
export const rememberScope3DirectValue = async (value: Scope3DirectValue): Promise<void> => {
  await writeFile(PENDING_RESTORE_FILE, JSON.stringify(value), 'utf8');
};

/** 控えてある値があれば戻して控えを消す。戻した値を返す（控えが無ければ null）。 */
export const restoreScope3DirectValue = async (): Promise<Scope3DirectValue | null> => {
  if (!existsSync(PENDING_RESTORE_FILE)) return null;
  const value = JSON.parse(await readFile(PENDING_RESTORE_FILE, 'utf8')) as Scope3DirectValue;
  const supabase = await createUserClient(ORG_A_USER);
  const { error } = await supabase.from('scope3_category_emissions').update({ emissions: value.emissions }).eq('id', value.id);
  if (error) throw new Error(`OGT の Scope 3 の直接入力を元に戻せませんでした（${value.id}）: ${error.message}`);
  await unlink(PENDING_RESTORE_FILE);
  return value;
};

/** 画面からログインする。 */
export const signIn = async (page: Page, user: DemoUser): Promise<void> => {
  await page.goto('/login');
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill(user.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(/\/dashboard/);
};

/** 社内確認用 CSV（UTF-16LE・BOM 付き・タブ区切り。src/lib/files/csv.ts）を行と列に分ける。 */
export const parseSsbjCsv = (buffer: Buffer): string[][] => {
  const text = buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
    ? buffer.subarray(2).toString('utf16le')
    : buffer.toString('utf8');
  return text
    .split(/\r?\n/)
    .filter(line => line !== '')
    .map(line => line.split('\t').map(cell => (cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell)));
};

// 10 進数の文字列（非負。例 "1544.000"）を、小数点以下 scale 桁の整数に直す（浮動小数点の誤差を入れない）。
const scaled = (value: string, scale: number): bigint => {
  const [integer, fraction = ''] = value.split('.');
  return BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
};

const scaleOf = (values: string[]): number => Math.max(0, ...values.map(value => (value.split('.')[1] ?? '').length));

/** 10 進数の文字列どうしの足し算。 */
export const addDecimals = (values: string[]): string => {
  const scale = scaleOf(values);
  const digits = values.reduce((sum, value) => sum + scaled(value, scale), BigInt(0)).toString().padStart(scale + 1, '0');
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
};

/** 10 進数の文字列が同じ値か（"1.500" と "1.5" は同じ）。 */
export const sameDecimal = (a: string, b: string): boolean => {
  const scale = scaleOf([a, b]);
  return scaled(a, scale) === scaled(b, scale);
};

/** トーストの表示を待つ。 */
export const expectToast = async (page: Page, text: string | RegExp): Promise<void> => {
  await expect(page.getByText(text).first()).toBeVisible();
};
