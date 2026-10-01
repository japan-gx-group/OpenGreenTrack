// SSBJ 全体テストの後片付け: テストが作ったレポートを消す（保存版・文章・判断なども連鎖削除される）。
// CSV の生成履歴（system_audit_logs）は監査ログのため消さない（本体のスモークと同じ扱い）。
// 画面で中身を見たいときは E2E_SSBJ_KEEP=1 を付けて実行すると残す（次回の実行開始時に消える）。

import { deleteE2eReports, restoreScope3DirectValue } from './support';

const globalTeardown = async (): Promise<void> => {
  // 元データを戻す前に手順が失敗・中断したときでも、OGT の値は必ず戻す（レポートを残す指定に関わらず）。
  const restored = await restoreScope3DirectValue();
  if (restored) console.log(`[e2e-ssbj] OGT の Scope 3 の直接入力（${restored.id}）を元に戻しました`);
  if (process.env.E2E_SSBJ_KEEP === '1') {
    console.log('[e2e-ssbj] E2E_SSBJ_KEEP=1 のため、テスト用レポートを残します');
    return;
  }
  const deleted = await deleteE2eReports();
  if (deleted > 0) console.log(`[e2e-ssbj] テスト用レポート ${deleted} 件を削除しました`);
};

export default globalTeardown;
