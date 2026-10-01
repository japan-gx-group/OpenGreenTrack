// 架空の保存版（fictionalSnapshot）に入っている値を「開示する内容」「内部記録」「GHG の数値」に分けて並べる。
// プレビュー・CSV のテストが「入力したものがすべて出る」「内部記録は開示する内容の欄に混ざらない」を
// 同じ一覧で確かめるために使う（R1 の全体確認）。
// 保存版のセクションを足したら、ここにも足す（SsbjSnapshotSections のキーを網羅していないと型エラーになる）。

import type { SsbjFieldValue, SsbjSnapshotSections } from '../types';
import { fictionalSnapshot } from './fictionalReport';

type SectionValues = {
  /** 開示する内容（入力済みの値と、名称など常に開示する値）。 */
  disclosed: string[];
  /** 内部記録（内部メモ・資料名など。開示しない）。 */
  internal: string[];
  /** GHG の数値（10 進数の文字列のまま。表示側で桁区切りを付ける）。 */
  ghgValues: string[];
};

const answered = (value: SsbjFieldValue<string>): string[] => (value.state === 'answered' ? [value.value] : []);
const present = (value: string | null): string[] => (value === null ? [] : [value]);
const none: SectionValues = { disclosed: [], internal: [], ghgValues: [] };

const BY_SECTION: { [K in keyof SsbjSnapshotSections]: (section: SsbjSnapshotSections[K]) => SectionValues } = {
  risks_opportunities: items => ({
    ...none,
    disclosed: items.flatMap(item => [item.title, ...answered(item.description.disclosure)]),
    internal: items.flatMap(item => present(item.description.internalNote)),
  }),
  time_horizons: definitions => ({
    ...none,
    disclosed: [definitions.shortTerm, definitions.mediumTerm, definitions.longTerm, definitions.planningHorizonRelation]
      .flatMap(answered),
    internal: present(definitions.internalNote),
  }),
  evidence: items => ({
    ...none,
    disclosed: items.flatMap(item => answered(item.disclosure)),
    internal: items.flatMap(item => [
      item.documentTitle,
      ...[item.documentVersion, item.internalLocation, item.referencePosition, item.ownerDepartment].flatMap(present),
    ]),
  }),
  ghg: ghg => ({
    ...none,
    ghgValues: ghg === null
      ? []
      : [...ghg.values.flatMap(value => answered(value.value)), ...ghg.supplierReferences.map(supplier => supplier.emissions)],
  }),
  narratives: items => ({
    ...none,
    disclosed: items.flatMap(narrative => answered(narrative.text.disclosure)),
    internal: items.flatMap(narrative => present(narrative.text.internalNote)),
  }),
  judgements: items => ({
    ...none,
    disclosed: items.flatMap(judgement => answered(judgement.explanation.disclosure)),
    internal: items.flatMap(judgement => present(judgement.explanation.internalNote)),
  }),
};

/** 保存版のセクションのキー（SsbjSnapshotSections の全キー）。 */
export const SSBJ_SNAPSHOT_SECTION_KEYS = Object.keys(BY_SECTION) as (keyof SsbjSnapshotSections)[];

const valuesOf = <K extends keyof SsbjSnapshotSections>(key: K): SectionValues => {
  const section = fictionalSnapshot.sections[key];
  if (section === undefined) throw new Error(`架空の保存版にセクション ${key} がありません`);
  return BY_SECTION[key](section as SsbjSnapshotSections[K]);
};

const all = SSBJ_SNAPSHOT_SECTION_KEYS.map(valuesOf);

/** 架空の保存版の、開示する内容（重複なし）。 */
export const fictionalDisclosedTexts: string[] = [...new Set(all.flatMap(values => values.disclosed))];
/** 架空の保存版の、内部記録（重複なし）。 */
export const fictionalInternalTexts: string[] = [...new Set(all.flatMap(values => values.internal))];
/** 架空の保存版の、GHG の数値（採用値とサプライヤー別の参考値。重複あり）。 */
export const fictionalGhgValues: string[] = all.flatMap(values => values.ghgValues);
