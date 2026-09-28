// SSBJ レポートの保存版（固定スナップショット）作成 API を画面から呼ぶクライアント側の処理。
// 版の生成は Route Handler（/api/ssbj/reports/[reportId]/versions）→ service_role 限定 RPC で行う。
// 画面から直接 ssbj_report_versions へ書かないのは、スナップショットの中身（特に OGT 由来の値）を
// クライアントが偽造できないようにするため（docs/ssbj-spec.md §8）。

export interface SavedSsbjReportVersion {
  id: string;
  versionNumber: number;
}

/**
 * 保存版を作る。expectedDraftRevision は画面が読込時（または直前の基本情報保存時）に受け取った版数。
 * 他の画面・他の人の変更で版数が進んでいれば、サーバが 409 で拒否し、そのメッセージを例外にする。
 */
export const saveSsbjReportVersion = async (
  reportId: string,
  expectedDraftRevision: number,
): Promise<SavedSsbjReportVersion> => {
  const response = await fetch(`/api/ssbj/reports/${encodeURIComponent(reportId)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedDraftRevision }),
  });
  const body = (await response.json().catch(() => null)) as
    | { id?: string; versionNumber?: number; error?: string }
    | null;
  if (!response.ok || typeof body?.id !== 'string' || typeof body.versionNumber !== 'number') {
    throw new Error(body?.error ?? '保存版の作成に失敗しました');
  }
  return { id: body.id, versionNumber: body.versionNumber };
};
