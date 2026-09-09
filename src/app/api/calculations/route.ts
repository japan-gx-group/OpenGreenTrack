// GHG算定バッチの実行トリガー（機能仕様 §6.2）。
// body で organizationId / fiscalYearId を受け取り、算定サービスを実行して結果を返す。
//
// 認証ガード:
//   算定サービスは service_role で RLS を越えて書き込むため、呼び出し元をここで
//   サーバ側検証する。ログイン済み・自組織のみ許可し、他組織の organizationId を
//   渡しても実行できない。
//   ロールによる絞り込みは行わない（ロール判定は無効）。RLS を越える経路の
//   ため、組織チェック（下の organizationId 比較）はここでしか担保できない。消さないこと。

import { NextResponse } from 'next/server';
import { runCalculationBatch } from '@/features/calculation/services/calculationService';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { ApiRequestError, RateLimitExceededError } from '@/lib/security/apiRateLimit';

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

  const { organizationId, fiscalYearId } = (body ?? {}) as {
    organizationId?: unknown;
    fiscalYearId?: unknown;
  };

  if (typeof organizationId !== 'string' || typeof fiscalYearId !== 'string') {
    return NextResponse.json(
      { error: 'organizationId と fiscalYearId（いずれも文字列）が必要です' },
      { status: 400 },
    );
  }

  // 他組織の organizationId を指定した実行を拒否する（自組織のみ）。
  if (organizationId !== profile.organizationId) {
    return NextResponse.json(
      { error: '自組織以外の算定は実行できません' },
      { status: 403 },
    );
  }

  try {
    const summary = await runCalculationBatch({ organizationId, fiscalYearId });
    // 算定自体が失敗（バッチ status=failed）でも 500 ではなく結果を返し、原因を提示する
    const status = summary.status === 'completed' ? 200 : 500;
    return NextResponse.json(summary, { status });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: 429,
          headers: { 'Retry-After': String(error.retryAfterSeconds) },
        },
      );
    }
    if (error instanceof ApiRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    // 生の DB エラーを呼び出し元へ返さないよう、詳細はサーバーログにのみ残す。
    log.error({ error, organizationId, fiscalYearId }, '予期しないエラー');
    return NextResponse.json(
      { error: 'サーバー内部エラーが発生しました' },
      { status: 500 },
    );
  }
};
