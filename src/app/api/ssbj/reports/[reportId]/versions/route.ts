// SSBJ レポートの保存版（固定スナップショット）を作る API（docs/ssbj-spec.md §8）。
// 採番・スナップショット生成・insert の原子性は service_role 限定の RPC create_ssbj_report_version
// （supabase/migrations/20260927180425_ssbj_report_versions.sql）に委ねる。
//
// 認証ガード: ログイン済みユーザーの自組織のレポートのみ版を作れる
// （組織スコープは RPC 引数 p_organization_id で強制。ロール判定はしない）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import {
  SSBJ_VERSION_SQLSTATE,
  SsbjReportVersionRpcError,
  createSsbjReportVersion,
} from '@/features/ssbj/services/versionServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // UUID 以外は RPC まで行かずに 404 相当で返す（DB エラー経由にしない）。
  if (!UUID_PATTERN.test(reportId)) {
    return NextResponse.json({ error: 'SSBJレポートが見つかりません' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正なJSONです' }, { status: 400 });
  }

  const { expectedDraftRevision, note, sourceVersionId } = (body ?? {}) as {
    expectedDraftRevision?: unknown;
    note?: unknown;
    sourceVersionId?: unknown;
  };

  if (typeof expectedDraftRevision !== 'number' || !Number.isInteger(expectedDraftRevision)) {
    return NextResponse.json(
      { error: 'expectedDraftRevision（整数）が必要です' },
      { status: 400 },
    );
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return NextResponse.json({ error: 'note は文字列で指定してください' }, { status: 400 });
  }
  if (
    sourceVersionId !== undefined &&
    sourceVersionId !== null &&
    (typeof sourceVersionId !== 'string' || !UUID_PATTERN.test(sourceVersionId))
  ) {
    return NextResponse.json(
      { error: 'sourceVersionId は UUID で指定してください' },
      { status: 400 },
    );
  }

  try {
    const result = await createSsbjReportVersion({
      reportId,
      organizationId: profile.organizationId,
      actorUserId: profile.id,
      expectedDraftRevision,
      note: note ?? null,
      sourceVersionId: sourceVersionId ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof SsbjReportVersionRpcError) {
      if (error.code === SSBJ_VERSION_SQLSTATE.reportInvalid) {
        return NextResponse.json({ error: 'SSBJレポートが見つかりません' }, { status: 404 });
      }
      if (error.code === SSBJ_VERSION_SQLSTATE.draftRevisionConflict) {
        return NextResponse.json(
          { error: '他の変更と競合しました。画面を開き直してから保存し直してください' },
          { status: 409 },
        );
      }
    }
    log.error({ error, reportId }, 'SSBJレポートの保存版作成に失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
