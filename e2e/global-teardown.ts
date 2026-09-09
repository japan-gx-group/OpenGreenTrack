// スモークテストが作った活動量レコードをローカルDBから片付ける。
//
// 失敗しても後始末は行いたいので、テスト結果に関わらず必ず実行される globalTeardown に置く。
// 片付け自体が失敗してもテスト結果は上書きしない（次回実行時に global-setup が再度消す）。

import { createSignedInClient, deleteE2eActivityRecords } from './support/testDb';

const globalTeardown = async (): Promise<void> => {
  try {
    const supabase = await createSignedInClient();
    const deleted = await deleteE2eActivityRecords(supabase);
    console.log(`[e2e] テストデータ ${deleted} 件を削除しました`);
  } catch (error) {
    console.warn('[e2e] テストデータの後片付けに失敗しました:', error);
  }
};

export default globalTeardown;
