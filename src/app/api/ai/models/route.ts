// 使えるモデルの一覧（GET）。AI の設定カードのプルダウンに並べる。
//
// 管理者だけが呼べる（モデルを選べるのは管理者だけで、一覧の取得は提供元の呼び出しを伴うため）。
// サーバが環境変数の API キーで提供元のモデル一覧 API を呼び、画像・PDF を読めて決まった形で出力できる
// モデルに絞って返す。API キーはブラウザに返さない。失敗の理由はサーバのログにだけ残し、画面には決まった文だけを返す。

import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/authz';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { listAvailableModels } from '@/lib/ai/models';

export const runtime = 'nodejs';

export const GET = async (request: NextRequest) => {
  const log = await getRequestLogger();
  const check = await requireAdmin();
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const result = await listAvailableModels(check.profile.organizationId, request.signal);
  if (!result.ok) {
    log.warn({ reason: result.reason }, 'AI のモデル一覧を取得できませんでした');
    return NextResponse.json(
      { error: result.error },
      { status: result.status, headers: result.status === 429 ? { 'Retry-After': '60' } : undefined },
    );
  }

  return NextResponse.json({ provider: result.provider, models: result.models });
};
