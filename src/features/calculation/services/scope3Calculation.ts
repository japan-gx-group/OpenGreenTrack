// Scope3積上げ算定（IDEA連携）の純関数群（docs/idea-scope3-spec.md §4.3）。
// I/O は行わない。calculationService が取得した行を受け取り、
//   1. idea_factors → EmissionFactorRow への正規化（§4.3-2）
//   2. 純粋コア computeEmissions の呼び出し（Scope1/2 とは分離。明示解決パス専用）
//   3. FK 詰め替え（emissionFactorId=null + ideaFactorId。§4.3-4）
// までを担う。純粋コア（computeEmissions / resolveEmissionFactor / units.ts）には手を入れない。

import { computeEmissions } from '../engine/computeEmissions';
import type {
  ActivityRecordRow,
  CalculationOutcome,
  EmissionFactorRow,
  EmissionResultInsert,
  IdeaFactorRow,
  IdeaImportRow,
} from '../types';

/** 参照切れの孤児レコード（ideaFactorId=null）に提示するメッセージ（§4.3-1） */
export const SCOPE3_FACTOR_MISSING_MESSAGE =
  '参照していた係数が削除されています。製品を再選択してください';

/**
 * IDEA係数を算定エンジンの EmissionFactorRow へ正規化する（§4.3-2）。
 * サービス層のみで使う変換。DBには保存しない。
 *
 * providerName='IDEA'（非null）が必須である点が本設計の要:
 * 既存の事業者別係数と同じ仕組み（resolveEmissionFactor の tierOf = Infinity）で
 * 自動解決の候補から構造的に除外され、明示指定（emissionFactorId = ideaFactorId）
 * でのみ適用される。regionName に '全国' を入れないこと（tier5 に載せない多層防御）。
 */
export const normalizeIdeaFactor = (f: IdeaFactorRow, applicableYear: number): EmissionFactorRow => ({
  id: f.id,                                   // = ideaFactorId。明示解決パスで照合される
  organizationId: f.organizationId,
  name: `${f.ideaCode} ${f.productName}`,
  energyType: 'scope3_activity',
  scope: 'scope3',
  factorValue: Number(f.gwpValue) / Number(f.baseFlowAmount),
  unit: `kg-CO2e/${f.unit}`,
  applicableYear,                              // バッチの対象年度（IDEAは年度非依存。前提フィルタを常に通す）
  regionName: '',                              // '全国' を入れないこと（tier5 に載せない多層防御）
  status: 'active',
  isCustom: false,
  locationId: null,
  supplierId: null,
  effectiveFrom: null,
  effectiveTo: null,
  providerName: 'IDEA',                        // ★必須・非null。tierOf = Infinity（自動解決対象外）を
                                               //   既存の事業者別係数と同じ仕組みで構造的に保証する
  providerNumber: null,
  menuName: null,
  factorType: null,
});

/**
 * 純粋コアの算定結果を emission_results への INSERT 形へ詰め替える（§4.3-4）。
 * 純粋コアが返す emissionFactorId には正規化行の id（= ideaFactorId）が入るが、
 * これは emission_factors への FK に入れてはならない（存在しない UUID のため
 * INSERT が FK 違反で全件ロールバックする）。必ず null + ideaFactorId へ詰め替える。
 */
export const toScope3Insert = (
  r: EmissionResultInsert,
  f: IdeaFactorRow,
  meta: IdeaImportRow,
  record: ActivityRecordRow,   // categoryId の供給元。r には載っていないので必須
): EmissionResultInsert => ({
  ...r,
  emissionFactorId: null,
  ideaFactorId: f.id,
  categoryId: record.scope3CategoryId ?? null,
  appliedFactorValue: Number(f.gwpValue) / Number(f.baseFlowAmount),
  appliedFactorUnit: `kg-CO2e/${f.unit}`,
  appliedFactorName: `${f.ideaCode} ${f.productName} (AIST-IDEA ${meta.version})`,
});

/**
 * Scope3積上げレコード群を算定する（純関数）。
 *
 * - records は energyType='scope3_activity' の未算定レコード全件（孤児を含む）。
 * - ideaFactorId が null、または参照先の係数・インポート記録が取得結果に無いレコードは
 *   算定に回さず SCOPE3_FACTOR_MISSING として unresolved に載せる（§4.3-1。
 *   providerName='IDEA' の正規化により、孤児が他の IDEA 係数へ自動マッチする経路は無い）。
 * - 算定は Scope1/2 と分離した computeEmissions 呼び出しで行い、レコード側
 *   emissionFactorId = ideaFactorId の明示解決パス（前提フィルタのみ・tier 不問）に乗せる。
 * - 結果は toScope3Insert で FK 詰め替え済み（emissionFactorId=null / ideaFactorId セット）。
 */
export const computeScope3Emissions = (
  records: ActivityRecordRow[],
  ideaFactors: IdeaFactorRow[],
  ideaImports: IdeaImportRow[],
  applicableYear: number,
): CalculationOutcome => {
  const factorById = new Map(ideaFactors.map((f) => [f.id, f] as const));
  const importById = new Map(ideaImports.map((m) => [m.id, m] as const));
  const recordById = new Map(records.map((r) => [r.id, r] as const));

  const outcome: CalculationOutcome = { results: [], unresolved: [], warnings: [] };
  const markMissing = (record: ActivityRecordRow): void => {
    outcome.unresolved.push({
      activityRecordId: record.id,
      locationId: record.locationId,
      energyType: record.energyType,
      reason: 'SCOPE3_FACTOR_MISSING',
      detail: SCOPE3_FACTOR_MISSING_MESSAGE,
    });
  };

  // 孤児（ideaFactorId=null）と参照先欠落（FK上は起きないが多層防御）を先に分離する。
  const resolvable: ActivityRecordRow[] = [];
  for (const record of records) {
    const factor = record.ideaFactorId ? factorById.get(record.ideaFactorId) : undefined;
    const meta = factor ? importById.get(factor.importId) : undefined;
    if (!factor || !meta) {
      markMissing(record);
      continue;
    }
    // 明示解決パスへ乗せる（emissionFactorId = ideaFactorId。§4.3-2）
    resolvable.push({ ...record, emissionFactorId: record.ideaFactorId });
  }

  const normalizedFactors = ideaFactors.map((f) => normalizeIdeaFactor(f, applicableYear));

  // Scope1/2 の呼び出しとは混ぜない（誤マッチ防止の多層防御。§4.3-2）。
  // regionName は渡さない（正規化行は regionName='' のため地域一致も発生しない）。
  const { results, unresolved, warnings } = computeEmissions(resolvable, normalizedFactors, {
    resolveContext: () => ({ applicableYear }),
  });
  // 単位不一致（UNIT_MISMATCH）等、純粋コアの未解決はそのまま引き継ぐ
  outcome.unresolved.push(...unresolved);
  // IDEA 正規化行は前提フィルタを常に通すため通常は空。読み替え/フォールバックが起きたら見逃さない。
  outcome.warnings.push(...warnings);

  for (const result of results) {
    const factor = result.emissionFactorId ? factorById.get(result.emissionFactorId) : undefined;
    const meta = factor ? importById.get(factor.importId) : undefined;
    const record = recordById.get(result.activityRecordId);
    if (!factor || !meta || !record) {
      // resolvable の構築時に検証済みのため通常到達しない（型安全のためのガード）
      if (record) {
        markMissing(record);
      }
      continue;
    }
    outcome.results.push(toScope3Insert(result, factor, meta, record));
  }

  return outcome;
};
