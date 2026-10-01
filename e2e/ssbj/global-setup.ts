// SSBJ 全体テストの開始前の後片付け: 前回の実行が残したテスト用のレポートを消し、戻せなかった OGT の値を戻す（中断・失敗で残ることがある）。

import { createUserClient, deleteE2eReports, ORG_A_USER, ORG_B_USER, restoreScope3DirectValue } from './support';

const globalSetup = async (): Promise<void> => {
  // ローカル Supabase とデモシードがそろっているかを、ログインできるかで先に確かめる。
  await createUserClient(ORG_A_USER);
  await createUserClient(ORG_B_USER);
  const restored = await restoreScope3DirectValue();
  if (restored) console.log(`[e2e-ssbj] 前回の実行で戻せなかった OGT の Scope 3 の直接入力（${restored.id}）を元に戻しました`);
  const deleted = await deleteE2eReports();
  if (deleted > 0) console.log(`[e2e-ssbj] 前回のテスト用レポート ${deleted} 件を削除しました`);
};

export default globalSetup;
