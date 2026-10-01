// SSBJ レポートの状態の変更と保存版の復元の API（Route Handler）を、画面から呼ぶクライアント側の処理。
// 権限・状態の遷移・競合の検証はサーバ（service_role 限定の RPC）が行う。失敗したときはサーバのメッセージを例外にする。

import type { SsbjReportStatus, SsbjReportStatusAction } from '../types';

export interface SsbjReportStatusChange {
  action: SsbjReportStatusAction;
  /** 画面が持っている draftRevision（承認は、この版数の内容を承認する）。 */
  expectedDraftRevision: number;
  /** レビュー依頼のときだけ。 */
  approverUserId?: string | null;
  comment?: string | null;
}

export interface SsbjReportStatusChangeResult {
  status: SsbjReportStatus;
  approverUserId: string | null;
  approvedVersionId: string | null;
  approvedVersionNumber: number | null;
}

const postJson = async <T>(url: string, payload: unknown, fallback: string): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new Error(body?.error ?? fallback);
  }
  return body;
};

export const changeSsbjReportStatus = (
  reportId: string,
  change: SsbjReportStatusChange,
): Promise<SsbjReportStatusChangeResult> =>
  postJson<SsbjReportStatusChangeResult>(
    `/api/ssbj/reports/${encodeURIComponent(reportId)}/status`,
    change,
    '状態の変更に失敗しました',
  );

export interface SsbjRestoreResult {
  restoredVersionNumber: number;
  backupVersionId: string;
  backupVersionNumber: number;
  draftRevision: number;
}

/** 作業中の内容を保存版の内容に戻す。戻す前の内容は、サーバが保存版として自動で残す。 */
export const restoreSsbjReportVersion = (
  reportId: string,
  versionId: string,
  expectedDraftRevision: number,
): Promise<SsbjRestoreResult> =>
  postJson<SsbjRestoreResult>(
    `/api/ssbj/reports/${encodeURIComponent(reportId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { expectedDraftRevision },
    '保存版の復元に失敗しました',
  );
