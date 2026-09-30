// SSBJ レポートに OGT の候補値を採用する API（T08b。docs/ssbj-spec.md §7・§8）。
// 受け取るのは画面が表示していた候補値の指紋だけで、採用する値はサーバが OGT から取り直す
// （services/ogtAdoptionServer.ts）。書き込みは service_role 限定の RPC adopt_ssbj_ogt_values。
//
// 認証ガード: ログイン済みユーザーの自組織のレポートにだけ採用できる（組織は getCurrentProfile から確定し、
// RPC 引数 p_organization_id で強制する。ロール判定はしない）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { SsbjOgtAdoptionError, adoptOgtCandidates } from '@/features/ssbj/services/ogtAdoptionServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const { reportId } = await params;
  if (!UUID_PATTERN.test(reportId)) {
    return NextResponse.json({ error: 'SSBJレポートが見つかりません' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正なJSONです' }, { status: 400 });
  }

  // 指紋以外の項目（値など）は読まない。送られてきても保存には使わない。
  const { expectedFingerprint } = (body ?? {}) as { expectedFingerprint?: unknown };
  if (typeof expectedFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    return NextResponse.json({ error: 'expectedFingerprint（16桁の16進数）が必要です' }, { status: 400 });
  }

  try {
    const result = await adoptOgtCandidates({
      reportId,
      organizationId: profile.organizationId,
      actorUserId: profile.id,
      expectedFingerprint,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SsbjOgtAdoptionError) {
      const status = error.reason === 'report_not_found' ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    log.error({ error, reportId }, 'SSBJレポートへのOGT値の採用に失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
