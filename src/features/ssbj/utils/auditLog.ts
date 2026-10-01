// SSBJ の操作履歴（docs/ssbj-spec.md §13「操作履歴」）の純関数: 画面・出力に出す言葉と、出力の行。
// 何を記録するかは DB（トリガー・RPC）が決める。ここは記録を人が読める形にするだけ。

import {
  SSBJ_REPORT_STATUS_LABELS,
  type SsbjAuditAction,
  type SsbjAuditLog,
  type SsbjReportStatus,
} from '../types';
import { isSsbjItemId, isSsbjRequirementId } from './ids';
import { findSsbjNarrativeItem, findSsbjRequirement } from './requirementMaster';

export const SSBJ_AUDIT_ACTION_LABELS: Record<SsbjAuditAction, string> = {
  create: '作成',
  update: '更新',
  delete: '削除',
  status_change: '状態の変更',
  version_create: '保存版の作成',
  version_restore: '保存版の復元',
  export: 'ファイルの出力',
};

const TARGET_TYPE_LABELS: Record<string, string> = {
  report: 'レポート（基本情報）',
  narrative: '四本柱の文章',
  judgement: '該当性・重要性の判断',
  risk_opportunity: 'リスク・機会',
  time_horizons: '時間軸の定義',
  evidence: '根拠文書',
  ogt_adoption: 'OGT の採用値',
  version: '保存版',
};

const STATUS_OPERATION_LABELS: Record<string, string> = {
  submit: 'レビュー依頼',
  withdraw: '依頼の取り下げ',
  approve: '承認',
  reopen: '差戻し',
};

const EXPORT_FORMAT_LABELS: Record<string, string> = {
  csv: '保存版の CSV',
  xlsx: '保存版の Excel',
  audit_csv: '操作履歴の CSV',
  audit_xlsx: '操作履歴の Excel',
};

// 列名 → 画面の言葉（変わった列の表示に使う）。無い列は列名のまま出す。
const COLUMN_LABELS: Record<string, string> = {
  title: '名称', purpose: '作成目的', reportingScope: '報告範囲', standardVersion: '参照する基準の版',
  parentCompanyName: '親会社名', parentRelationship: '親会社との関係', ownershipPercentage: '持分比率',
  measurementApproach: '測定アプローチ', industryCode: '業種',
  disclosureState: '開示する内容の状態', disclosureText: '開示する内容', internalNote: '内部メモ',
  applicability: '該当性', materiality: '重要性', omissionReason: '記載しない理由',
  explanationState: '開示する説明の状態', explanationText: '開示する説明', internalReason: '内部の検討理由',
  kind: '区分', riskTypeState: 'リスクの種類の状態', riskType: 'リスクの種類', descriptionState: '説明の状態',
  descriptionText: '説明', timeHorizonState: '時間軸の状態', timeHorizon: '時間軸', linkTargets: '関連する章・項目',
  shortTermState: '短期の状態', shortTerm: '短期', mediumTermState: '中期の状態', mediumTerm: '中期',
  longTermState: '長期の状態', longTerm: '長期', planningHorizonRelationState: '計画期間との関係の状態',
  planningHorizonRelation: '計画期間との関係',
  itemId: '項目', documentTitle: '資料名', documentVersion: '版', internalLocation: '保管先',
  referencePosition: '参照位置', ownerDepartment: '主管部署',
  adoptedValues: '採用値', supplierReferences: 'サプライヤー別の参考値', adoptedAt: '採用日時', adoptedByUserId: '採用者',
};

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** 対象の名前（例: 「四本柱の文章: 監督する機関・責任者」）。 */
export const ssbjAuditTargetLabel = (log: SsbjAuditLog): string => {
  const kind = TARGET_TYPE_LABELS[log.targetType] ?? log.targetType;
  const label = text(log.details.label);
  switch (log.targetType) {
    case 'narrative': {
      const item = isSsbjItemId(log.targetId) ? findSsbjNarrativeItem(log.targetId) : undefined;
      return `${kind}: ${item?.label ?? log.targetId ?? ''}`;
    }
    case 'judgement': {
      const requirement = isSsbjRequirementId(log.targetId) ? findSsbjRequirement(log.targetId) : undefined;
      return `${kind}: ${log.targetId ?? ''}${requirement ? `（${requirement.summary}）` : ''}`;
    }
    case 'evidence':
    case 'risk_opportunity':
      return label ? `${kind}: ${label}` : kind;
    case 'version': {
      const versionNumber = num(log.details.versionNumber);
      return versionNumber === null ? kind : `${kind}: 版 ${versionNumber}`;
    }
    default:
      return kind;
  }
};

const statusLabel = (value: unknown): string =>
  typeof value === 'string' && value in SSBJ_REPORT_STATUS_LABELS
    ? SSBJ_REPORT_STATUS_LABELS[value as SsbjReportStatus]
    : String(value ?? '');

/** 操作の中身（変わった項目・状態の前後・出力形式など）。 */
export const ssbjAuditDetail = (log: SsbjAuditLog, nameOf: (userId: string | null) => string): string => {
  const { details } = log;
  switch (log.action) {
    case 'update':
      return (log.changedColumns ?? []).map(column => COLUMN_LABELS[column] ?? column).join('、');
    case 'status_change': {
      const operation = STATUS_OPERATION_LABELS[String(details.operation)] ?? String(details.operation ?? '');
      const parts = [`${operation}（${statusLabel(details.from)} → ${statusLabel(details.to)}）`];
      if (details.operation === 'submit') parts.push(`承認者: ${nameOf(text(details.approverUserId))}`);
      if (num(details.versionNumber) !== null) parts.push(`承認した版: 版 ${num(details.versionNumber)}`);
      if (text(details.comment)) parts.push(`コメント: ${text(details.comment)}`);
      return parts.join(' / ');
    }
    case 'version_create':
      return text(details.note) ?? '';
    case 'version_restore':
      return `版 ${num(details.versionNumber) ?? '?'} の内容に戻した（戻す前の内容は 版 ${num(details.backupVersionNumber) ?? '?'}）`;
    case 'export': {
      const format = EXPORT_FORMAT_LABELS[String(details.format)] ?? String(details.format ?? '');
      return num(details.versionNumber) === null ? format : `${format}（版 ${num(details.versionNumber)}）`;
    }
    default:
      return '';
  }
};

/** 出力の列見出し。 */
export const SSBJ_AUDIT_EXPORT_HEADER = ['日時', '操作した人', '操作', '対象', '内容', '対象ID'];

/** 操作履歴を出力の行にする（見出しの行を含む。日時は ISO 形式のまま）。 */
export const ssbjAuditExportRows = (
  logs: readonly SsbjAuditLog[],
  nameOf: (userId: string | null) => string,
  reportTitle: string,
  generatedAt: string,
): string[][] => [
  ['SSBJレポート 操作履歴（社内確認用）'],
  ['レポート名', reportTitle],
  ['生成日時', generatedAt],
  ['件数', String(logs.length)],
  [],
  SSBJ_AUDIT_EXPORT_HEADER,
  ...logs.map(log => [
    log.createdAt,
    nameOf(log.actorUserId),
    SSBJ_AUDIT_ACTION_LABELS[log.action],
    ssbjAuditTargetLabel(log),
    ssbjAuditDetail(log, nameOf),
    log.targetId ?? '',
  ]),
];
