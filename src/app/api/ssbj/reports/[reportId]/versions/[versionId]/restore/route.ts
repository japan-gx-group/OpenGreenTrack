// SSBJ レポートの作業中の内容を、指定した保存版の内容に戻す API（docs/ssbj-spec.md §13「版の復元」）。
// 戻す前の内容の保存（自動の保存版）・各機能の作業中データの作り直し・競合と承認済みの検証は、
// service_role 限定の RPC restore_ssbj_report_version（supabase/migrations/20261002090200_ssbj_restore_version.sql）が
// 1 トランザクションで行う。操作者・組織はサーバ側のセッションから決める。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import {
  SSBJ_WORKFLOW_SQLSTATE,
  SsbjWorkflowRpcError,
  restoreSsbjReportVersion,
} from '@/features/ssbj/services/reportWorkflowServer';
import { SSBJ_LOCKED_MESSAGE } from '@/features/ssbj/utils/writeError';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_RESPONSES: Record<string, { status: number; error: string }> = {
  [SSBJ_WORKFLOW_SQLSTATE.reportInvalid]: { status: 404, error: 'SSBJレポートまたは保存版が見つかりません' },
  [SSBJ_WORKFLOW_SQLSTATE.draftRevisionConflict]: {
    status: 409,
    error: '他の変更と競合しました。画面を開き直してから、もう一度復元してください',
  },
  [SSBJ_WORKFLOW_SQLSTATE.locked]: { status: 409, error: SSBJ_LOCKED_MESSAGE },
  [SSBJ_WORKFLOW_SQLSTATE.versionUnrestorable]: {
    status: 422,
    error: 'この保存版は、今の画面に戻せない項目を含むため復元できません（作業中の内容は変わっていません）',
  },
};

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ reportId: string; versionId: string }> },
) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const { reportId, versionId } = await params;
  if (!UUID_PATTERN.test(reportId) || !UUID_PATTERN.test(versionId)) {
    return NextResponse.json({ error: 'SSBJレポートまたは保存版が見つかりません' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正なJSONです' }, { status: 400 });
  }
  const { expectedDraftRevision } = (body ?? {}) as { expectedDraftRevision?: unknown };
  if (typeof expectedDraftRevision !== 'number' || !Number.isInteger(expectedDraftRevision)) {
    return NextResponse.json({ error: 'expectedDraftRevision（整数）が必要です' }, { status: 400 });
  }

  try {
    const result = await restoreSsbjReportVersion({
      reportId,
      organizationId: profile.organizationId,
      actorUserId: profile.id,
      versionId,
      expectedDraftRevision,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SsbjWorkflowRpcError && error.code && ERROR_RESPONSES[error.code]) {
      const { status, error: message } = ERROR_RESPONSES[error.code];
      return NextResponse.json({ error: message }, { status });
    }
    log.error({ error, reportId, versionId }, 'SSBJレポートの保存版の復元に失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
