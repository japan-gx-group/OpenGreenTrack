// スモークテスト開始前の前提チェックと後片付け。
//
// ここでローカル環境の不備（Supabase 未起動・seed 未投入）や、直前の実行が残した状態を
// 先に解消しておくと、ブラウザ側で分かりにくい失敗に化けるのを防げる。

import {
  createSignedInClient,
  deleteE2eActivityRecords,
  waitForCalculationPendingSlot,
  waitForCalculationRateLimit,
} from './support/testDb';
import { CALCULATION_RUNS_PER_SUITE } from './support/testData';

const globalSetup = async (): Promise<void> => {
  const supabase = await createSignedInClient();

  // 前回の実行が異常終了して残ったレコードを消す。
  // 残っていると (拠点, 種別, 対象月) の重複チェックに引っかかって手動入力の保存が失敗する。
  const deleted = await deleteE2eActivityRecords(supabase);
  if (deleted > 0) {
    console.log(`[e2e] 前回のテストデータ ${deleted} 件を削除しました`);
  }

  // 算定APIには「稼働中1件まで」と「1分あたりN件まで」（CALCULATION_PER_MINUTE_LIMIT）の2つの制限がある。
  // 前者（中断で残った pending 行）は最大10分ブロックし続けるため、件数制限より先に解消を待つ。
  await waitForCalculationPendingSlot(supabase);

  // 続けて流したときに算定APIのレート制限に当たらないよう、必要な枠が空くまで待つ。
  await waitForCalculationRateLimit(supabase, CALCULATION_RUNS_PER_SUITE);
};

export default globalSetup;
