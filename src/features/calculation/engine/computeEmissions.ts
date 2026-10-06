// 算定エンジンの中核（純関数・副作用なし）。
// 各活動量レコードに係数を解決し、単位換算のうえで
//   排出量(t-CO2e) = 活動量 × 排出係数
// を計算する。DBアクセスは一切行わない（テスト対象）。

import type {
  ActivityRecordRow,
  CalculationOutcome,
  EmissionFactorRow,
  Scope2Basis,
  Scope2BasisEvidence,
  Scope2BasisResultInsert,
  Scope2BasisUnresolved,
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
 * Scope 2 の基準別算定（GHG プロトコルのロケーション基準／マーケット基準）。
 * 単一値（emission_results）とは独立した規則で算定する:
 *   - ロケーション基準: 公式の標準係数（providerName なし・カスタム係数除外）を優先順位で解決して
 *     適用する。現状の収録では全国代替値（系統平均の代替）が該当する。
 *   - マーケット基準: 供給事業者のメニュー別係数（providerName あり = 明示選択でしか適用されない
 *     契約根拠）が解決されればそれを適用し、無ければ公式の標準係数で補完する
 *     （evidence='grid_fallback'。日本には残差ミックスの公表が無く、GHG プロトコルの階層の
 *     最下位＝系統平均へ落とすため）。
 * 温対法の係数区分（基礎/調整後）から基準を推定することはしない。契約根拠の判定は
 * 「事業者別係数が解決されたか」だけで行い、組織のカスタム係数も基準の根拠として扱わない
 * （カスタム係数は事業者・メニュー・区分の情報を持てず、何の値か機械判定できないため）。
 * 単一値が算定できたレコード（または算定済みのレコード）だけを対象に呼ぶ。
 */
export const resolveScope2BasisForRecord = (
  record: ActivityRecordRow,
  factors: EmissionFactorRow[],
  context: FactorResolutionContext,
): { results: Scope2BasisResultInsert[]; unresolved: Scope2BasisUnresolved[] } => {
  const results: Scope2BasisResultInsert[] = [];
  const unresolved: Scope2BasisUnresolved[] = [];

  const pushUnresolved = (basis: Scope2Basis, detail: string) => {
    unresolved.push({ activityRecordId: record.id, basis, detail });
  };

  // 単位換算まで通ったときだけ挿入内容を作る（係数はあるが換算できない場合は null）。
  const toBasisInsert = (
    basis: Scope2Basis,
    evidence: Scope2BasisEvidence,
    factor: EmissionFactorRow,
  ): Scope2BasisResultInsert | null => {
    const conversion = resolveUnitConversion(record.unit, factor.unit);
    if (conversion === null) return null;
    return {
      activityRecordId: record.id,
      basis,
      evidence,
      emissionFactorId: factor.id,
      emissions: roundEmissions(record.amount * conversion * factor.factorValue),
      // 適用係数のスナップショット（emission_results の appliedFactor* と同じ理由で保持）
      appliedFactorValue: factor.factorValue,
      appliedFactorUnit: factor.unit,
      appliedFactorName: factor.name,
    };
  };

  // 公式の標準係数だけで自動解決する（明示指定・カスタム係数・事業者別係数の影響を受けない）。
  // 暫定適用（未公表年度の過年度流用）や温対法年度の突き合わせは単一値の解決と同じ規則に乗る。
  const standardFactors = factors.filter(
    (factor) => !factor.isCustom && factor.organizationId === null && factor.providerName === null,
  );
  const standardResolution = resolveEmissionFactorDetailed(
    { ...record, emissionFactorId: null },
    standardFactors,
    context,
  );
  const standardFactor =
    standardResolution.status === 'resolved' && standardResolution.factor.scope === 'scope2'
      ? standardResolution.factor
      : null;

  // ロケーション基準: 標準係数（系統平均の代替）そのもの。
  if (standardFactor) {
    const insert = toBasisInsert('location_based', 'grid_average', standardFactor);
    if (insert) {
      results.push(insert);
    } else {
      pushUnresolved(
        'location_based',
        `活動量の単位「${record.unit}」を標準係数の単位「${standardFactor.unit}」に換算できません`,
      );
    }
  } else {
    pushUnresolved(
      'location_based',
      `energyType=${record.energyType} に適用できる公式の標準係数（代替値）が見つかりません`,
    );
  }

  // マーケット基準: 契約根拠（明示選択された事業者別係数）があればそれを使う。
  // 明示指定の年度読み替え（explicit_remapped）も同一事業者・同一メニュー・同一区分に限られるため
  // 契約根拠として扱う。explicit_fallback で標準係数へ落ちた場合は契約根拠にならない。
  const mainResolution = resolveEmissionFactorDetailed(record, factors, context);
  const contractFactor =
    mainResolution.status === 'resolved' &&
    mainResolution.factor.scope === 'scope2' &&
    mainResolution.factor.providerName !== null
      ? mainResolution.factor
      : null;

  if (contractFactor) {
    const insert = toBasisInsert('market_based', 'contract_menu', contractFactor);
    if (insert) {
      results.push(insert);
    } else {
      pushUnresolved(
        'market_based',
        `活動量の単位「${record.unit}」を契約メニュー係数の単位「${contractFactor.unit}」に換算できません`,
      );
    }
  } else if (standardFactor) {
    const insert = toBasisInsert('market_based', 'grid_fallback', standardFactor);
    if (insert) {
      results.push(insert);
    } else {
      pushUnresolved(
        'market_based',
        `活動量の単位「${record.unit}」を標準係数の単位「${standardFactor.unit}」に換算できません`,
      );
    }
  } else {
    pushUnresolved(
      'market_based',
      `契約メニュー係数の明示選択が無く、補完に使う公式の標準係数（代替値）も見つかりません`,
    );
  }

  return { results, unresolved };
};

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
  const outcome: CalculationOutcome = {
    results: [],
    unresolved: [],
    warnings: [],
    scope2BasisResults: [],
    scope2BasisUnresolved: [],
  };

  for (const record of records) {
    const context = resolveContext(record);
    const resolution = resolveEmissionFactorDetailed(record, factors, context);

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

    // Scope 2 は単一値と独立に基準別（ロケーション／マーケット）も算定する。
    // 単一値が成立したレコードだけが対象（未算定レコードに基準別だけ付くことはない）。
    if (factor.scope === 'scope2') {
      const basisOutcome = resolveScope2BasisForRecord(record, factors, context);
      outcome.scope2BasisResults.push(...basisOutcome.results);
      outcome.scope2BasisUnresolved.push(...basisOutcome.unresolved);
    }
  }

  return outcome;
};
