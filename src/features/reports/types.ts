// レポート種別の正本ラベル。画面・CSV・印刷ビューで同じ表記を使うため一元管理する。
import type { ReportTypeId } from './services/reportService';

export const REPORT_TYPE_LABELS: Record<ReportTypeId, string> = {
  annual_summary: '年度温室効果ガス排出サマリ',
  scope3_detail: 'Scope 3 カテゴリ別詳細分析',
  location_breakdown: '拠点別排出量・エネルギー内訳',
};

// 種別の追加漏れを防ぐため、判定は正本 REPORT_TYPE_LABELS のキーから導出する。
export const isReportTypeId = (value: string): value is ReportTypeId =>
  Object.prototype.hasOwnProperty.call(REPORT_TYPE_LABELS, value);

// Scope 3 詳細レポートは組織・年度単位のカテゴリ集計で、画面の拠点選択を使わない。
// 「拠点を絞ったつもりで組織全体の数値が出る」誤読を防ぐため、拠点選択を使う種別かを
// 一箇所で判定し、画面・印刷ビュー・生成履歴がすべて同じ判断に従うようにする。
export const usesLocationFilter = (type: ReportTypeId): boolean => type !== 'scope3_detail';

// 拠点選択を使わない種別の「対象拠点」表記（レポートのメタ情報と生成履歴で共通）。
export const ORGANIZATION_WIDE_TARGET_LABEL = '組織全体';
