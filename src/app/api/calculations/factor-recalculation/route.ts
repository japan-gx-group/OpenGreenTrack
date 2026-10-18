// 組織の排出係数（カスタム係数）の値を変えたときの、算定済みレコードの再算定対象への差し戻し（POST）。
//
// 係数の編集は行の上書きで、算定済みの結果は算定時の値のまま残る（算定バッチは isCalculated = false の
// レコードしか処理しない）。係数管理画面で値・単位を変えて「再算定する」を選んだとき、その係数で
// 算定済みのレコードを再算定対象へ戻す（実際の算定は呼び出し側が続けて POST /api/calculations で行う）。
//
// 認証ガード（/api/calculations と同方針）:
//   サービス層は service_role で RLS を越えて読み書きするため、呼び出し元をここで検証する。
//   対象組織は body ではなくログイン中プロフィールから取る（他組織を指定した実行が原理的に不可能）。
//   RLS を越える経路のため、この検証はここでしか担保できない。消さないこと。

import { NextResponse } from 'next/server';
import { resetRecordsCalculatedWithFactor } from '@/features/calculation/services/factorRecalculation';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）
export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正なJSONです' }, { status: 400 });
  }

  const { factorId } = (body ?? {}) as { factorId?: unknown };
  if (typeof factorId !== 'string' || factorId === '') {
    return NextResponse.json({ error: 'factorId（文字列）が必要です' }, { status: 400 });
  }

  try {
    const result = await resetRecordsCalculatedWithFactor({
      organizationId: profile.organizationId,
      factorId,
    });
    // 自組織に無い係数IDは、公式係数・他組織の係数・存在しない係数。いずれも 404 で区別を返さない。
    if (!result) {
      return NextResponse.json({ error: '排出係数が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    // 生の DB エラーを呼び出し元へ返さないよう、詳細はサーバーログにのみ残す。
    log.error({ error, factorId }, '係数変更に伴う再算定対象への差し戻しに失敗');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
