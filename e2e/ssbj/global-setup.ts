// SSBJ 全体テストの開始前の後片付け: 前回の実行が残したテスト用のレポートを消し、戻せなかった OGT の値を戻す（中断・失敗で残ることがある）。

import {
  createUserClient, deleteE2eReports, ORG_A_APPROVER, ORG_A_USER, ORG_B_USER, restoreLocationName, restoreScope3DirectValue,
} from './support';

const globalSetup = async (): Promise<void> => {
  // ローカル Supabase とデモシードがそろっているかを、ログインできるかで先に確かめる。
  await createUserClient(ORG_A_USER);
  await createUserClient(ORG_B_USER);
  // 承認担当（確認 三郎）は SSBJ のデモシード（ssbj_demo.sql）だけが作る。無ければ SSBJ のデモシードを流していない。
  await createUserClient(ORG_A_APPROVER).catch((error: unknown) => {
    throw new Error(`承認担当（${ORG_A_APPROVER.email}）でログインできません。SSBJ のデモシード（supabase/seeds/demo/ssbj_demo.sql）を流してください: ${String(error)}`);
  });
  const restored = await restoreScope3DirectValue();
  if (restored) console.log(`[e2e-ssbj] 前回の実行で戻せなかった OGT の Scope 3 の直接入力（${restored.id}）を元に戻しました`);
  const location = await restoreLocationName();
  if (location) console.log(`[e2e-ssbj] 前回の実行で戻せなかった OGT の拠点名（${location.id}）を元に戻しました`);
  const deleted = await deleteE2eReports();
  if (deleted > 0) console.log(`[e2e-ssbj] 前回のテスト用レポート ${deleted} 件を削除しました`);
};

export default globalSetup;
