// SSBJ レポートの状態を変える API（レビュー依頼・取り下げ・承認・差戻し。docs/ssbj-spec.md §13）。
// 権限（承認・差戻しは指定された承認者か管理者だけ）・状態の遷移・競合の検証は、service_role 限定の RPC
// change_ssbj_report_status（supabase/migrations/20261002090100_ssbj_report_status.sql）が行う。
// 操作者・組織はサーバ側のセッションから決め、クライアントから受け取らない。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import {
  SSBJ_WORKFLOW_SQLSTATE,
  SsbjWorkflowRpcError,
  changeSsbjReportStatus,
} from '@/features/ssbj/services/reportWorkflowServer';
import { SSBJ_REPORT_STATUS_ACTIONS, type SsbjReportStatusAction } from '@/features/ssbj/types';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_MAX_LENGTH = 1000;

const ERROR_RESPONSES: Record<string, { status: number; error?: string }> = {
  [SSBJ_WORKFLOW_SQLSTATE.reportInvalid]: { status: 404, error: 'SSBJレポートが見つかりません' },
  [SSBJ_WORKFLOW_SQLSTATE.draftRevisionConflict]: {
    status: 409,
    error: '他の変更と競合しました。画面を開き直してから、もう一度操作してください',
  },
  // 次の 3 つは RPC のメッセージ（利用者向けの日本語）をそのまま返す。
  [SSBJ_WORKFLOW_SQLSTATE.approverInvalid]: { status: 400 },
  [SSBJ_WORKFLOW_SQLSTATE.forbidden]: { status: 403 },
  [SSBJ_WORKFLOW_SQLSTATE.invalidTransition]: { status: 409 },
};

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

  const { action, expectedDraftRevision, approverUserId, comment } = (body ?? {}) as {
    action?: unknown;
    expectedDraftRevision?: unknown;
    approverUserId?: unknown;
    comment?: unknown;
  };

  if (typeof action !== 'string' || !(SSBJ_REPORT_STATUS_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: '状態の操作が不正です' }, { status: 400 });
  }
  if (typeof expectedDraftRevision !== 'number' || !Number.isInteger(expectedDraftRevision)) {
    return NextResponse.json({ error: 'expectedDraftRevision（整数）が必要です' }, { status: 400 });
  }
  if (approverUserId !== undefined && approverUserId !== null &&
    (typeof approverUserId !== 'string' || !UUID_PATTERN.test(approverUserId))) {
    return NextResponse.json({ error: '承認者の指定が不正です' }, { status: 400 });
  }
  if (comment !== undefined && comment !== null &&
    (typeof comment !== 'string' || comment.length > COMMENT_MAX_LENGTH)) {
    return NextResponse.json({ error: `コメントは${COMMENT_MAX_LENGTH}文字以内で入力してください` }, { status: 400 });
  }

  try {
    const result = await changeSsbjReportStatus({
      reportId,
      organizationId: profile.organizationId,
      actorUserId: profile.id,
      action: action as SsbjReportStatusAction,
      expectedDraftRevision,
      approverUserId: (approverUserId as string | null | undefined) ?? null,
      comment: (comment as string | null | undefined) ?? null,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof SsbjWorkflowRpcError && error.code && ERROR_RESPONSES[error.code]) {
      const { status, error: message } = ERROR_RESPONSES[error.code];
      return NextResponse.json({ error: message ?? error.message }, { status });
    }
    log.error({ error, reportId }, 'SSBJレポートの状態の変更に失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
