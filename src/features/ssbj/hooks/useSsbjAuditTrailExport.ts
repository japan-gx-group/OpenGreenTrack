'use client';

// 証跡一式（R2-33）の出力の状態と送信。保存版を選び、内部メモ・内部記録を含めるか（既定は含めない）を決めて出力する。
// 出力は操作履歴に記録してから行う（記録できなければ出力しない）。

import { useState } from 'react';
import { listSsbjAuditLogs, recordSsbjExport } from '../services/auditLogService';
import { buildSsbjAuditTrailSheets, getSsbjAuditTrailDetails, ssbjAuditTrailFileName } from '../services/auditTrailService';
import { getCurrentSsbjUserId, listSsbjMembers, memberName } from '../services/memberService';
import { getSsbjCsvVersion } from '../services/versionExportService';
import { buildSsbjWorkbook, downloadSsbjWorkbook } from '../services/versionXlsx';

export const useSsbjAuditTrailExport = (reportId: string, approvedVersionId: string | null) => {
  /** 出力の確認を開いている保存版。 */
  const [versionId, setVersionId] = useState<string | null>(null);
  const [internalRecords, setInternalRecords] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const open = (id: string) => {
    setVersionId(id);
    // 内部記録は、出力のたびに既定（含めない）に戻す（前回の選択のまま社外に渡さないため）。
    setInternalRecords(false);
    setErrorMessage('');
  };
  const close = () => { if (!isExporting) setVersionId(null); };

  const exportTrail = async (): Promise<boolean> => {
    if (!versionId || isExporting) return false;
    setIsExporting(true);
    setErrorMessage('');
    try {
      const version = await getSsbjCsvVersion(reportId, versionId);
      const [trail, logs, members, userId] = await Promise.all([
        getSsbjAuditTrailDetails(version.snapshot.report.fiscalYearId),
        listSsbjAuditLogs(reportId),
        listSsbjMembers(),
        getCurrentSsbjUserId(),
      ]);
      const nameOf = (id: string | null) => memberName(members, id);
      const generatedAt = new Date().toISOString();
      const sheets = buildSsbjAuditTrailSheets({
        version,
        isApprovedVersion: approvedVersionId === version.id,
        generatedAt,
        generatedBy: nameOf(userId),
        internalRecords,
      }, trail, logs, nameOf);
      const workbook = await buildSsbjWorkbook(sheets);
      // 記録してから出力する（誰がいつ出力したかを残せない出力をさせない）。
      await recordSsbjExport(reportId, 'trail_xlsx', version.id);
      await downloadSsbjWorkbook(workbook, ssbjAuditTrailFileName(version.versionNumber, generatedAt));
      setVersionId(null);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '証跡一式の出力に失敗しました');
      return false;
    } finally {
      setIsExporting(false);
    }
  };

  return { versionId, internalRecords, setInternalRecords, isExporting, errorMessage, open, close, exportTrail };
};
