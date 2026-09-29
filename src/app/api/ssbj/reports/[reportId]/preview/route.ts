// SSBJ レポートの作業中の内容を、保存版と同じ形で返す API（T12 のプレビュー。docs/ssbj-spec.md §8）。
// 保存はしない。組み立ては service_role 限定の RPC preview_ssbj_report（services/previewServer.ts）。
//
// 認証ガード: ログイン済みユーザーの自組織のレポートだけを返す（組織は getCurrentProfile から確定し、
// RPC 引数 p_organization_id で強制する。他組織・存在しないレポートは区別せず 404）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { previewSsbjReport } from '@/features/ssbj/services/previewServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = async (
  _request: Request,
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

  try {
    const preview = await previewSsbjReport({ reportId, organizationId: profile.organizationId });
    if (!preview) {
      return NextResponse.json({ error: 'SSBJレポートが見つかりません' }, { status: 404 });
    }
    return NextResponse.json(preview, { status: 200 });
  } catch (error) {
    log.error({ error, reportId }, 'SSBJレポートのプレビューの組み立てに失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
