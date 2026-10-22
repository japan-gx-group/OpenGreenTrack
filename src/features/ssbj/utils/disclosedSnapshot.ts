// SSBJ の保存版（SsbjReportSnapshotV1）から、内部メモ・内部記録（docs/ssbj-spec.md §5）を除く純関数。
// 閲覧者には、承認した保存版の開示する内容だけを見せる（docs/authorization-matrix.md §2.3）。保存版の行は RLS で閲覧者に見せず、
// Route Handler（/api/ssbj/reports/[reportId]/approved-version）がこの関数で除いてから返す。
//
// 項目ごとに「開示する」か「内部記録」かを、保存版の部分（report と各セクション）ごとに下の表で決める。
// 表に無い項目・セクションは、内部記録と同じく除く（分類していない新しい項目が、そのまま閲覧者に出ないようにするため）。
// 除いた項目は unclassifiedPaths で返すので、呼び出し元はログに残す。項目・セクションを足したら、この表にも足すこと
// （__tests__/disclosedSnapshot.test.ts が、架空の保存版の全項目が表にあるかを確かめる）。
//
// 内部記録は null にせず、キーごと除く。読む側（プレビュー・保存履歴・CSV / Excel）はキーの欠落を未入力と同じく扱う
// （docs/ssbj-spec.md §8。項目を足す前の保存版と同じ）。null にすると「内部メモ: 未入力」と出て、書いていないように見えるため。

import type { SsbjReportSnapshotV1, SsbjSnapshotSections } from '../types';

/**
 * 項目の分類。パスは、report・セクションの要素（配列のセクション）・セクションそのもの（オブジェクトのセクション）からの相対で、
 * 入れ子は `.`、配列の要素は `[]` でつなぐ（例 `description.internalNote`、`values[].source`）。
 * 載せたパスの値は丸ごと開示する／除く。その下の項目までは分けない。
 */
export type SsbjFieldClassification = {
  disclosed: readonly string[];
  internal: readonly string[];
};

/** 保存版の各部分の分類。セクションのキーは SsbjSnapshotSections と同じ（足し忘れると型エラーになる）。 */
export const SSBJ_SNAPSHOT_FIELD_CLASSIFICATION: {
  report: SsbjFieldClassification;
  sections: Record<keyof SsbjSnapshotSections, SsbjFieldClassification>;
} = {
  // 基本情報はすべて開示する（閲覧者には承認済みのレポートの行も見せている）。
  report: {
    disclosed: [
      'id', 'organizationId', 'fiscalYearId', 'title', 'purpose', 'reportingScope', 'standardVersion',
      'parentCompanyName', 'parentRelationship', 'ownershipPercentage', 'measurementApproach', 'industryCode',
      'createdAt', 'updatedAt', 'fiscalYearLabel', 'periodStart', 'periodEnd',
    ],
    internal: [],
  },
  sections: {
    risks_opportunities: {
      disclosed: ['id', 'kind', 'title', 'riskType', 'description.disclosure', 'timeHorizon', 'linkTargets'],
      internal: ['description.internalNote'],
    },
    time_horizons: {
      disclosed: ['shortTerm', 'mediumTerm', 'longTerm', 'planningHorizonRelation'],
      internal: ['internalNote'],
    },
    // 開示するのは開示用参照文だけ。資料名・版・保管先・参照位置・主管部署・ファイルの照合用の記録は内部記録。
    evidence: {
      disclosed: ['id', 'itemId', 'disclosure'],
      internal: [
        'documentTitle', 'documentVersion', 'internalLocation', 'referencePosition', 'ownerDepartment',
        'fileName', 'fileSha256', 'fileStorageVersionId', 'fileStoredBy', 'fileRecordedAt',
      ],
    },
    // 値・算定状態・採用方式・参考値はプレビューに出す。取得元（集計・算定バッチ）と件数は CSV の内部記録の列にだけ出し、
    // 採用した人は操作の記録（閲覧者には操作履歴を見せない）なので、内部記録とする。
    ghg: {
      disclosed: [
        'adoptedAt',
        'values[].scope', 'values[].scope3CategoryId', 'values[].method', 'values[].value', 'values[].unit',
        'values[].fiscalYearId', 'values[].period', 'values[].boundary', 'values[].dataQuality', 'values[].adoptedAt',
        'supplierReferences[].kind', 'supplierReferences[].fiscalYearId', 'supplierReferences[].scope3CategoryId',
        'supplierReferences[].supplierId', 'supplierReferences[].supplierName', 'supplierReferences[].emissions',
        'supplierReferences[].unit',
      ],
      internal: ['adoptedBy', 'values[].adoptedBy', 'values[].source', 'values[].coverage'],
    },
    narratives: {
      disclosed: ['itemId', 'text.disclosure'],
      internal: ['text.internalNote'],
    },
    judgements: {
      disclosed: ['requirementId', 'applicability', 'materiality', 'omissionReason', 'explanation.disclosure'],
      internal: ['explanation.internalNote'],
    },
  },
};

type Rules = {
  disclosed: ReadonlySet<string>;
  internal: ReadonlySet<string>;
  /** 下に分類した項目がある、オブジェクトの項目。 */
  objects: ReadonlySet<string>;
  /** 下に分類した項目がある、配列の項目。 */
  arrays: ReadonlySet<string>;
};

const toRules = (classification: SsbjFieldClassification): Rules => {
  const objects = new Set<string>();
  const arrays = new Set<string>();
  for (const path of [...classification.disclosed, ...classification.internal]) {
    // 'a[].b.c' の上の項目: 'a'（配列）と 'a[].b'（オブジェクト）。
    let prefix = '';
    for (const part of path.split('.').slice(0, -1)) {
      const isArray = part.endsWith('[]');
      const name = isArray ? part.slice(0, -2) : part;
      const current = prefix ? `${prefix}.${name}` : name;
      (isArray ? arrays : objects).add(current);
      prefix = isArray ? `${current}[]` : current;
    }
  }
  return { disclosed: new Set(classification.disclosed), internal: new Set(classification.internal), objects, arrays };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 分類に従って項目を選ぶ。分類に無い項目は除き、その場所（where からのパス）を unclassified に足す。 */
const pick = (
  value: Record<string, unknown>,
  rules: Rules,
  prefix: string,
  where: string,
  unclassified: Set<string>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (rules.disclosed.has(path)) {
      result[key] = item;
    } else if (rules.internal.has(path)) {
      continue;
    } else if (rules.objects.has(path) && isPlainObject(item)) {
      result[key] = pick(item, rules, path, where, unclassified);
    } else if (rules.arrays.has(path) && Array.isArray(item)) {
      result[key] = item.filter(isPlainObject).map(element => pick(element, rules, `${path}[]`, where, unclassified));
    } else {
      unclassified.add(`${where}.${path}`);
    }
  }
  return result;
};

const REPORT_RULES = toRules(SSBJ_SNAPSHOT_FIELD_CLASSIFICATION.report);
const SECTION_RULES = new Map<string, Rules>(
  Object.entries(SSBJ_SNAPSHOT_FIELD_CLASSIFICATION.sections).map(([key, classification]) => [key, toRules(classification)]),
);

/**
 * 保存版から内部メモ・内部記録を除いた、開示する内容だけの保存版を返す（元の保存版は変えない）。
 * unclassifiedPaths は、分類に無かったため除いた項目・セクション（例 `sections.ghg.values[].note`）。空でなければ分類の足し忘れ。
 */
export const toSsbjDisclosedSnapshot = (
  snapshot: SsbjReportSnapshotV1,
): { snapshot: SsbjReportSnapshotV1; unclassifiedPaths: string[] } => {
  const unclassified = new Set<string>();
  const source = snapshot as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === 'schemaVersion') {
      result[key] = value;
    } else if (key === 'report') {
      if (isPlainObject(value)) result[key] = pick(value, REPORT_RULES, '', 'report', unclassified);
    } else if (key === 'sections') {
      if (!isPlainObject(value)) continue;
      const sections: Record<string, unknown> = {};
      for (const [sectionKey, section] of Object.entries(value)) {
        const rules = SECTION_RULES.get(sectionKey);
        const where = `sections.${sectionKey}`;
        if (!rules) {
          unclassified.add(where);
        } else if (section === null) {
          // 採用していない GHG など、セクションの値が null（欠落と区別するため残す）。
          sections[sectionKey] = null;
        } else if (Array.isArray(section)) {
          sections[sectionKey] = section.filter(isPlainObject).map(item => pick(item, rules, '', `${where}[]`, unclassified));
        } else if (isPlainObject(section)) {
          sections[sectionKey] = pick(section, rules, '', where, unclassified);
        } else {
          unclassified.add(where);
        }
      }
      result[key] = sections;
    } else {
      unclassified.add(key);
    }
  }

  return { snapshot: result as unknown as SsbjReportSnapshotV1, unclassifiedPaths: [...unclassified].sort() };
};
