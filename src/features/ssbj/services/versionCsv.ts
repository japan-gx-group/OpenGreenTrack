// SSBJ の固定版だけを社内確認用 CSV の行へ変換する。OGT や編集中のテーブルは読まない。

import { downloadCsv } from '@/lib/files/csv';
import { timestampForFileName } from '@/lib/files/download';
import {
  OGT_EMISSION_UNIT,
  SSBJ_MEASUREMENT_APPROACH_LABELS,
  SSBJ_PARENT_RELATIONSHIP_LABELS,
  SSBJ_RISK_OPPORTUNITY_KIND_LABELS,
  SSBJ_RISK_TYPE_LABELS,
  SSBJ_TIME_HORIZON_LABELS,
  type SsbjReportVersion,
} from '../types';
import { formatFieldValue } from '../utils/fieldValue';
import { ghgAdoptionCsvRows } from './versionCsvGhg';

// CSV に出せる保存版セクション。ここに無いセクションがあれば、出力漏れにせずエラーにする。
const CSV_SECTIONS = new Set(['risks_opportunities', 'time_horizons', 'evidence', 'ghg']);

export type SsbjCsvVersion = Pick<SsbjReportVersion, 'id' | 'reportId' | 'versionNumber' | 'snapshot'>;

export const ssbjVersionToCsvRows = (version: SsbjCsvVersion, generatedAt: string): string[][] => {
  const { snapshot } = version;
  if (snapshot?.schemaVersion !== 1 || !snapshot.report || !snapshot.sections) {
    throw new Error('対応していない保存版の形式です');
  }
  if (snapshot.report.id !== version.reportId) {
    throw new Error('保存版のレポートIDが一致しません');
  }

  const unknownSections = Object.keys(snapshot.sections).filter(key => !CSV_SECTIONS.has(key));
  if (unknownSections.length > 0) {
    throw new Error(`CSVに未対応の保存項目があります: ${unknownSections.join(', ')}`);
  }

  const report = snapshot.report;
  const rows: string[][] = [
    ['SSBJレポート（社内確認用・未承認）'],
    ['版ID', version.id],
    ['版番号', String(version.versionNumber)],
    ['レポートID', version.reportId],
    ['対象年度', report.fiscalYearLabel],
    ['対象期間', `${report.periodStart} 〜 ${report.periodEnd}`],
    ['排出量の単位', OGT_EMISSION_UNIT],
    ['生成日時', generatedAt],
    ['位置付け', '試行版。SSBJ基準への準拠や対外提出の完了を保証しません。'],
    ['算定値の注意', 'OGTの公式係数は実質CO2のみで、他ガスは含まれません。算定済みはデータの網羅性を保証しません。'],
    [],
    ['章', '対象ID', '項目', '状態', '開示内容', '単位', '内部記録', '注記'],
  ];

  const basic = (name: string, value: string | null | undefined): void => {
    rows.push(['基本情報', report.id, name, value == null ? '未入力' : '入力済み', value ?? '', '', '', '']);
  };
  basic('レポート名', report.title);
  basic('作成目的', report.purpose);
  basic('報告範囲', report.reportingScope);
  basic('参照する基準の版', report.standardVersion);
  basic('親会社名', report.parentCompanyName);
  basic('親会社との関係', report.parentRelationship ? SSBJ_PARENT_RELATIONSHIP_LABELS[report.parentRelationship] : null);
  basic('親会社の持分比率（%）', report.ownershipPercentage);
  basic('測定アプローチ', report.measurementApproach ? SSBJ_MEASUREMENT_APPROACH_LABELS[report.measurementApproach] : null);
  basic('業種（SICS）', report.industryCode);

  const risks = snapshot.sections.risks_opportunities;
  if (risks !== undefined) {
    if (!Array.isArray(risks)) throw new Error('リスク・機会の保存内容が不正です');
    for (const item of risks) {
      const group = SSBJ_RISK_OPPORTUNITY_KIND_LABELS[item.kind];
      if (!group || !item.description?.disclosure || !item.timeHorizon || !Array.isArray(item.linkTargets)) {
        throw new Error('リスク・機会の保存内容が不正です');
      }
      rows.push([group, item.id, '名称', '入力済み', item.title, '', '', '']);
      const riskType = item.riskType ?? { state: 'unanswered' as const };
      if (item.kind === 'risk') rows.push([
        group, item.id, 'リスクの種類',
        formatFieldValue(riskType, () => '入力済み'),
        formatFieldValue(riskType, value => SSBJ_RISK_TYPE_LABELS[value]),
        '', '', '',
      ]);
      rows.push([
        group,
        item.id,
        '説明',
        formatFieldValue(item.description.disclosure, () => '入力済み'),
        formatFieldValue(item.description.disclosure),
        '',
        item.description.internalNote ?? '',
        '',
      ]);
      rows.push([
        group,
        item.id,
        '時間軸',
        formatFieldValue(item.timeHorizon, () => '入力済み'),
        formatFieldValue(item.timeHorizon, value => SSBJ_TIME_HORIZON_LABELS[value]),
        '',
        '',
        '',
      ]);
      rows.push([
        group,
        item.id,
        '関連する章・項目',
        item.linkTargets.length > 0 ? '入力済み' : '未入力',
        item.linkTargets.join('、'),
        '',
        '',
        '',
      ]);
    }
  }
  const timeHorizons = snapshot.sections.time_horizons;
  if (timeHorizons !== undefined) {
    if (!timeHorizons || !timeHorizons.shortTerm || !timeHorizons.mediumTerm ||
      !timeHorizons.longTerm || !timeHorizons.planningHorizonRelation) {
      throw new Error('時間軸の定義の保存内容が不正です');
    }
    const definition = (name: string, value: typeof timeHorizons.shortTerm): void => {
      rows.push(['時間軸の定義', report.id, name,
        formatFieldValue(value, () => '入力済み'), formatFieldValue(value), '', '', '']);
    };
    definition('短期', timeHorizons.shortTerm);
    definition('中期', timeHorizons.mediumTerm);
    definition('長期', timeHorizons.longTerm);
    definition('戦略上の計画期間との関係', timeHorizons.planningHorizonRelation);
    rows.push(['時間軸の定義', report.id, '内部メモ',
      timeHorizons.internalNote ? '入力済み' : '未入力', '', '', timeHorizons.internalNote ?? '', '']);
  }
  const evidence = snapshot.sections.evidence;
  if (evidence !== undefined) {
    if (!Array.isArray(evidence)) throw new Error('根拠文書の保存内容が不正です');
    for (const item of evidence) {
      if (!item.id || !item.itemId || !item.documentTitle || !item.disclosure ||
        !['unanswered', 'unconfirmed', 'not_applicable', 'answered'].includes(item.disclosure.state) ||
        (item.disclosure.state === 'answered' && !item.disclosure.value?.trim())) {
        throw new Error('根拠文書の保存内容が不正です');
      }
      rows.push([
        '根拠文書', item.itemId, '開示用参照文',
        formatFieldValue(item.disclosure, () => '入力済み'),
        formatFieldValue(item.disclosure),
        '', '', `根拠ID: ${item.id}`,
      ]);
      for (const [name, value] of [
        ['資料名', item.documentTitle],
        ['版', item.documentVersion],
        ['保管先', item.internalLocation],
        ['参照位置', item.referencePosition],
        ['主管部署', item.ownerDepartment],
      ] as const) {
        rows.push([
          '根拠文書', item.itemId, name,
          value === null ? '未入力' : '入力済み',
          '', '', value ?? '', `根拠ID: ${item.id}`,
        ]);
      }
    }
  }
  const ghg = snapshot.sections.ghg;
  if (ghg !== undefined) rows.push(...ghgAdoptionCsvRows(report.id, ghg));
  return rows;
};

export const downloadSsbjVersionCsv = (
  version: SsbjCsvVersion,
  rows: string[][],
  generatedAt: string,
): void => {
  downloadCsv(`SSBJ_社内確認用_版${version.versionNumber}_${timestampForFileName(generatedAt)}.csv`, rows);
};
