// 暫定適用のまま残った算定済みレコードの検出（GET）と、再算定対象への差し戻し（POST）。
//
// 対象年度の公式係数が未公表の間は過年度の係数を暫定適用して算定する。正式係数を投入しても
// 算定バッチは isCalculated = false のレコードしか処理しないため、暫定適用で算定済みの結果は
// 古い係数のまま残る。GET で「再算定が必要な年度と件数」を返し、POST で該当レコードを
// 再算定対象へ戻す（実際の算定は呼び出し側が続けて POST /api/calculations で行う）。
//
// 認証ガード（/api/calculations と同方針）:
//   サービス層は service_role で RLS を越えて読み書きするため、呼び出し元をここで検証する。
//   対象組織は body ではなくログイン中プロフィールから取る（他組織を指定した実行が原理的に不可能）。
//   RLS を越える経路のため、この検証はここでしか担保できない。消さないこと。

import { NextResponse } from 'next/server';
import {
  findProvisionalRecalculationTargets,
  resetProvisionalCalculatedRecords,
} from '@/features/calculation/services/provisionalRecalculation';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）
export const runtime = 'nodejs';

export const GET = async () => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  try {
    const targets = await findProvisionalRecalculationTargets(profile.organizationId);
    return NextResponse.json({ targets });
  } catch (error) {
    log.error({ error, organizationId: profile.organizationId }, '暫定適用の検出に失敗');
    return NextResponse.json(
      { error: '再算定が必要なデータの確認に失敗しました' },
      { status: 500 },
    );
  }
};

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

  const { fiscalYearId } = (body ?? {}) as { fiscalYearId?: unknown };
  if (typeof fiscalYearId !== 'string' || fiscalYearId === '') {
    return NextResponse.json({ error: 'fiscalYearId（文字列）が必要です' }, { status: 400 });
  }

  try {
    const result = await resetProvisionalCalculatedRecords({
      organizationId: profile.organizationId,
      fiscalYearId,
    });
    // 自組織に無い年度IDは、他組織の年度か存在しない年度。どちらも 404 で区別を返さない。
    if (!result) {
      return NextResponse.json({ error: '算定年度が見つかりません' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    // 生の DB エラーを呼び出し元へ返さないよう、詳細はサーバーログにのみ残す。
    log.error({ error, fiscalYearId }, '再算定対象への差し戻しに失敗');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
