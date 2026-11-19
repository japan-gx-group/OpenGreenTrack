// 固定版のスナップショットをそのまま表示する。作業中データや最新の OGT 値は参照しない。
// 保存履歴の「内容を見る」の「表で見る」タブ（SsbjVersionView.client.tsx）。レポートの形の表示はプレビューと同じ本文で描き、
// こちらは保存した項目を漏れなく確かめるための表。見出しと項目名は分かるものだけ日本語にし、分からないキーはそのまま出す。

import { SsbjReportBasicInfo } from './SsbjReportBasicInfo';
import type { ReactNode } from 'react';
import type { SsbjCsvVersion } from '../services/versionCsv';

const labels: Record<string, string> = {
  risks_opportunities: 'リスク・機会',
  time_horizons: '時間軸の定義',
  narratives: '四本柱の文章',
  judgements: '該当性・重要性の判断',
  evidence: '根拠文書',
  ghg: 'GHG排出量（OGT の採用値）',
  external_emissions: '外部で算定した排出量',
  itemId: '項目ID',
  requirementId: '要求ID',
  text: '文章',
  explanation: '説明',
  applicability: '該当性',
  materiality: '重要性',
  omissionReason: '記載しない理由',
  documentTitle: '資料名',
  documentVersion: '資料の版',
  internalLocation: '保管先',
  referencePosition: '参照位置',
  ownerDepartment: '主管部署',
  title: '名称',
  kind: '区分',
  riskType: 'リスクの種類',
  description: '説明',
  disclosure: '開示文',
  internalNote: '内部メモ（開示しない）',
  timeHorizon: '時間軸',
  linkTargets: '関連する章・項目',
  shortTerm: '短期',
  mediumTerm: '中期',
  longTerm: '長期',
  planningHorizonRelation: '戦略上の計画期間との関係',
};

const states: Record<string, string> = {
  answered: '入力済み',
  unanswered: '未入力',
  unconfirmed: '未確認',
  not_applicable: '非該当',
};

const showValue = (value: unknown): ReactNode => {
  if (value === null || value === undefined) return <span className="text-text-muted">未入力</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-muted">なし</span>;
    return <ol className="m-0 list-decimal space-y-2 pl-5">{value.map((item, index) => <li key={index}>{showValue(item)}</li>)}</ol>;
  }
  if (typeof value === 'object') {
    const fields = value as Record<string, unknown>;
    if (typeof fields.state === 'string' && fields.state in states) {
      return <span>{states[fields.state]}{fields.state === 'answered' && <>：{showValue(fields.value)}</>}</span>;
    }
    return (
      <dl className="m-0 space-y-2">
        {Object.entries(fields).map(([key, item]) => (
          <div key={key}>
            <dt className="text-xs font-semibold text-text-muted">{labels[key] ?? key}</dt>
            <dd className="m-0 whitespace-pre-wrap text-sm">{showValue(item)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
};

export const SsbjVersionContents = ({ version }: { version: SsbjCsvVersion }) => {
  const snapshot = version.snapshot;
  if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.report || !snapshot.sections || snapshot.report.id !== version.reportId) {
    return <p role="alert">対応していない保存版の形式です。</p>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-bold">基本情報</h3>
        <SsbjReportBasicInfo report={snapshot.report} />
      </section>
      {Object.entries(snapshot.sections).map(([key, value]) => (
        <section key={key}>
          <h3 className="mb-3 text-sm font-bold">{labels[key] ?? key}</h3>
          {showValue(value)}
        </section>
      ))}
    </div>
  );
};
