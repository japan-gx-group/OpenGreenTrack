// 算定エンジンの中核（純関数・副作用なし）。
// 各活動量レコードに係数を解決し、単位換算のうえで
//   排出量(t-CO2e) = 活動量 × 排出係数
// を計算する。DBアクセスは一切行わない（テスト対象）。

import type {
  ActivityRecordRow,
  CalculationOutcome,
  EmissionFactorRow,
} from '../types';
import {
  deriveApplicableYear,
  resolveEmissionFactorDetailed,
  type FactorResolutionContext,
} from './resolveEmissionFactor';
import { scopeForEnergyType } from './energyTypeScope';
import { scope3CategoryIdForEnergyType } from './scope3Category';
import { resolveUnitConversion } from './units';

export interface ComputeEmissionsOptions {
  /**
   * 各活動量レコードに対する係数解決コンテキスト（適用年度・地域名）を返す。
   * 省略時は periodStart から会計年度を導出し、地域一致（レベル4）は行わない。
   * サービス層は locationId→regionName の対応と会計年度をここで注入する。
   */
  resolveContext?: (record: ActivityRecordRow) => FactorResolutionContext;
}

/**
 * numeric(15,6) に合わせて小数第6位へ丸める。
 * Scope3積上げ算定では 0.5kg 未満の小口明細が第3位丸めで全て 0 に落ち
 * 系統的過小計上になるため、保存精度を 1g 粒度（10^-6 t）へ拡張した（表示丸めは第3位 = 1kg 粒度）。
 */
export const roundEmissions = (value: number): number =>
  Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const defaultResolveContext = (record: ActivityRecordRow): FactorResolutionContext => ({
  applicableYear: deriveApplicableYear(record.periodStart),
});

/**
 * 活動量レコード群に排出係数を適用し、算定結果と未解決レコードを返す。
 * 純粋（副作用なし）なので、同じ入力に対して常に同じ結果を返す。
 */
export const computeEmissions = (
  records: ActivityRecordRow[],
  factors: EmissionFactorRow[],
  options: ComputeEmissionsOptions = {},
): CalculationOutcome => {
  const resolveContext = options.resolveContext ?? defaultResolveContext;
  const outcome: CalculationOutcome = { results: [], unresolved: [], warnings: [] };

  for (const record of records) {
    const resolution = resolveEmissionFactorDetailed(record, factors, resolveContext(record));

    if (resolution.status === 'not_found') {
      outcome.unresolved.push({
        activityRecordId: record.id,
        locationId: record.locationId,
        energyType: record.energyType,
        reason: 'FACTOR_NOT_FOUND',
        detail: `energyType=${record.energyType} に適合する有効な排出係数が見つかりません`,
      });
      continue;
    }
    // 同順位の候補が複数（例: A重油 / B・C重油）で明示選択が無いレコードは、id 順で選ぶと
    // 誤った係数で静かに算定されるため未算定に留め、入力フォームでの係数選択を促す。
    if (resolution.status === 'ambiguous') {
      const names = [...new Set(resolution.candidates.map((candidate) => candidate.name))];
      outcome.unresolved.push({
        activityRecordId: record.id,
        locationId: record.locationId,
        energyType: record.energyType,
        reason: 'FACTOR_AMBIGUOUS',
        detail: `energyType=${record.energyType} に該当する排出係数が複数あります（${names.join(' / ')}）。入力フォームで排出係数を選択してください`,
      });
      continue;
    }
    // 最上位の優先度段階の係数がどれも活動量の単位から換算できない。単位換算が可能な係数が
    // 同じ段階にあれば resolveEmissionFactorDetailed がそちらを選ぶので、ここに来るのは全滅のときだけ。
    if (resolution.status === 'unit_mismatch') {
      const units = [...new Set(resolution.candidates.map((candidate) => candidate.unit))];
      outcome.unresolved.push({
        activityRecordId: record.id,
        locationId: record.locationId,
        energyType: record.energyType,
        reason: 'UNIT_MISMATCH',
        detail: `活動量の単位「${record.unit}」を係数の単位「${units.join(' / ')}」に換算できません`,
      });
      continue;
    }
    const factor = resolution.factor;

    // 係数の適用範囲がエネルギー種別の Scope と食い違うレコードは算定しない。算定すると
    // 集計（emission_results の scope・categoryId）とデータ充足状況（energyType 由来の Scope）が
    // 別々の基準で数えることになり、排出量が黙ってどの集計からも落ちる／載っているのに
    // 「採用されない」と注記される（engine/energyTypeScope.ts）。
    const expectedScope = scopeForEnergyType(record.energyType);
    if (factor.scope !== expectedScope) {
      outcome.unresolved.push({
        activityRecordId: record.id,
        locationId: record.locationId,
        energyType: record.energyType,
        reason: 'FACTOR_SCOPE_MISMATCH',
        detail: `排出係数「${factor.name}」の適用範囲が ${factor.scope} ですが、energyType=${record.energyType} は ${expectedScope} です`,
      });
      continue;
    }

    // 明示指定（emissionFactorId）の係数は単位を見ずに採用されるため、換算可否はここで確認する。
    const conversion = resolveUnitConversion(record.unit, factor.unit);
    if (conversion === null) {
      outcome.unresolved.push({
        activityRecordId: record.id,
        locationId: record.locationId,
        energyType: record.energyType,
        reason: 'UNIT_MISMATCH',
        detail: `活動量の単位「${record.unit}」を係数の単位「${factor.unit}」に換算できません`,
      });
      continue;
    }

    // 明示選択した係数が使われなかった場合は警告に載せる。算定結果の appliedFactorName に
    // 実際に使った係数は焼き付くが、それだけでは「指定と違う」ことが利用者に伝わらないため。
    if (resolution.requestedFactorId !== null) {
      const remapped = resolution.kind === 'explicit_remapped';
      outcome.warnings.push({
        activityRecordId: record.id,
        locationId: record.locationId,
        energyType: record.energyType,
        reason: remapped ? 'EXPLICIT_FACTOR_REMAPPED' : 'EXPLICIT_FACTOR_FALLBACK',
        requestedFactorId: resolution.requestedFactorId,
        appliedFactorId: factor.id,
        detail: remapped
          ? `選択された係数は対象年度に適用できないため、同じ事業者の「${factor.name}」で算定しました`
          : `選択された係数は適用できないため（アーカイブ済み・年度不一致等）、「${factor.name}」で算定しました`,
      });
    }

    const emissions = roundEmissions(record.amount * conversion * factor.factorValue);

    outcome.results.push({
      activityRecordId: record.id,
      emissionFactorId: factor.id,
      locationId: record.locationId,
      scope: factor.scope,
      // Scope3 の標準係数（廃棄物・輸送・出張・通勤など）は categoryId が無いと
      // refresh_dashboard_aggregates の集計対象にならないため、energyType から補う。
      // Scope1/2 と IDEA 積上げ（レコード側の scope3CategoryId で後から詰め替える）は null。
      categoryId: factor.scope === 'scope3' ? scope3CategoryIdForEnergyType(record.energyType) : null,
      emissions,
      // 適用係数のスナップショット。emissionFactorId は生きた行への参照でしかなく、
      // 公式係数 seed の再投入（on conflict (id) do update で factorValue を上書き）・
      // カスタム係数の編集・削除（FK は on delete set null）で算定根拠が失われる。
      // 算定時点の値をここへ焼き付け、あとから「どの係数で計算したか」を再現できるようにする。
      // 公式係数の name は事業者名・メニュー名・基礎/調整後を含むため、そのまま監査に足りる。
      // IDEA 積上げは toScope3Insert が版情報込みの値で上書きする。
      appliedFactorValue: factor.factorValue,
      appliedFactorUnit: factor.unit,
      appliedFactorName: factor.name,
    });
  }

  return outcome;
};
