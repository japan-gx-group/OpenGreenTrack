// 閲覧者（読み取り専用のロール）の書き込みを止めたときの案内と、ブラウザ経路での確かめ方。
//
// サーバ（service_role の Route Handler）は src/lib/authz.ts の requireWrite で 403 にし、この文言を返す。
// ブラウザから Supabase へ直接書く経路は RLS（current_user_can_edit() を使う restrictive ポリシー）が止める。
// ただし RLS の USING で止められた update / delete はエラーにならず 0 件で返り、insert / upsert は 42501 で失敗する。
// どちらも画面からは「見つかりません」「保存に失敗しました」や、成功したように見えてしまう。
// 書き込みが通らなかったときに throwIfWriteForbidden を呼び、今も書けるかを DB に聞いて、書けなければ権限の文言にする。

import { createClient } from '@/lib/supabase/client';

export const WRITE_FORBIDDEN_MESSAGE = '閲覧者は閲覧のみ可能です。編集はできません';

/**
 * 書き込み（update / delete が 0 件、または insert / upsert の失敗）のあとに呼ぶ。
 * DB の current_user_can_edit() が false なら WRITE_FORBIDDEN_MESSAGE の Error を投げる。
 * 確かめられないとき（通信の失敗など）は何もしない（呼び出し元の案内のままにする）。
 * 書き込みの前ではなく失敗したときだけ呼ぶので、成功した保存に問い合わせは増えない。
 */
export const throwIfWriteForbidden = async (): Promise<void> => {
  let result: { data: unknown; error: unknown };
  try {
    result = await createClient().rpc('current_user_can_edit');
  } catch {
    return;
  }
  if (!result.error && result.data === false) throw new Error(WRITE_FORBIDDEN_MESSAGE);
};
