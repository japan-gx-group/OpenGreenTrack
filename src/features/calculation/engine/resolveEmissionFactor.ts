// 排出係数の解決（純関数・副作用なし）。
// 正本の優先順位は docs/calculation-logic.md にまとめている（機能仕様 §7.3・DB設計書 §4.1 も同じ 5 段階）。
// 5 段階の優先度に、factorType='adjusted'（調整後）優先を同一優先度内のタイブレークとして組み合わせる。
// 事業者別係数（providerName あり）は自動解決の対象外で、明示選択（emissionFactorId）専用。
// 自動解決ではさらに活動量の単位と換算可能な係数だけを採用する（単位互換は最上位の
// 優先度段階の中でのみ見る。上位段階の係数を単位不一致で飛ばして下位段階へ落ちることはしない）。

import type { ActivityRecordRow, EmissionFactorRow } from '../types';
import { REGION_NAME_NATIONWIDE } from '../types';
import { resolveUnitConversion } from './units';

export interface FactorResolutionContext {
  /**
   * 組織の会計年度の開始年（fiscal_years.startDate の年）。
   * 係数の applicableYear はこの年か、periodStart から導いた温対法年度（4月〜翌3月）のどちらかに
   * 一致すればよい（applicableYearsForRecord）。公式係数は温対法年度＋有効期間で、
   * 有効期間を持たないカスタム係数は会計年度の開始年で突き合わせるための二本立て。
   */
  applicableYear: number;
  /**
   * 拠点の地域に対応する係数の regionName（レベル4「地域一致の標準係数」の判定用）。
   * 省略/ null の場合はレベル4をスキップし、全国標準（レベル5）のみを標準係数として扱う。
   */
  regionName?: string | null;
}

/**
 * 係数解決に必要な最小限のレコード情報。
 * 保存済みの ActivityRecordRow のほか、入力途中のフォーム値（手動入力・CSVプレビュー）からも
 * 組み立てられるよう、算定エンジンが参照するフィールドだけに絞っている。
 */
export type FactorResolutionRecord = Pick<
  ActivityRecordRow,
  'locationId' | 'energyType' | 'periodStart'
> & {
  /** 保存時に明示選択された係数ID。候補内にあれば優先順位より優先して使う */
  emissionFactorId?: string | null;
  /**
   * 活動量の単位（activity_records.unit）。指定すると自動解決で「この単位から換算できる係数」だけを
   * 採用する（resolveEmissionFactorDetailed）。省略/ null なら単位を見ずに優先順位だけで解決する
   * （入力フォームの候補一覧は、係数側の分母単位で入力し直せるため単位で絞らない）。
   */
  unit?: string | null;
};

/** 会計年度（4月〜翌3月）を periodStart から導出する。1〜3月は前年の年度扱い。 */
export const deriveApplicableYear = (periodStart: string): number => {
  const [yearPart, monthPart] = periodStart.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return year;
  }
  return month >= 4 ? year : year - 1;
};

const uniqueSortedYears = (years: number[]): number[] =>
  [...new Set(years.filter((year) => Number.isInteger(year)))].sort((a, b) => a - b);

/**
 * 会計年度（startDate〜endDate）に属するレコードが参照し得る係数の applicableYear 群。
 * 公式係数は 4月〜翌3月の温対法年度で生成される（scripts/official-factors/generate.ts）ため、
 * 7月始まりのような非4月始まりの会計年度は途中で温対法年度をまたぐ。
 * 「会計年度の開始年」だけで係数を取得すると、またいだ後の月（例: 7月始まり FY2025 の 2026年4〜6月）は
 * 2025年度の係数が有効期間外になり FACTOR_NOT_FOUND に落ちるため、
 * 開始年・開始日の温対法年度・終了日の温対法年度をまとめて取得対象にする（昇順・重複なし）。
 */
export const applicableYearsForFiscalYear = (startDate: string, endDate: string): number[] =>
  uniqueSortedYears([
    Number(startDate.slice(0, 4)),
    deriveApplicableYear(startDate),
    deriveApplicableYear(endDate),
  ]);

/**
 * 1 レコードが参照し得る係数の applicableYear 群（会計年度の開始年 と periodStart の温対法年度）。
 * 有効期間を持つ公式係数は periodStart の温対法年度側で、有効期間を持たないカスタム係数は
 * 組織の会計年度の開始年側でそれぞれ一致する。4月始まりの組織では両者は常に同じ 1 年になる。
 */
export const applicableYearsForRecord = (
  periodStart: string,
  fiscalYearStartYear: number,
): number[] => uniqueSortedYears([fiscalYearStartYear, deriveApplicableYear(periodStart)]);

/**
 * 対象年度の公式係数が未公表のときに、過年度の係数を暫定適用してよい最大の遡り年数。
 * 公式係数（電気・ガス・熱・燃料・Scope3）は毎年度公表されるため、未公表期間は最大1年度で解消する。
 * これを超えて古い係数を黙って使うと算定根拠として説明できないため、候補に載せず未算定にする
 * （未算定はデータ入力画面とレポートの「データ充足状況」に件数として出るため、
 * 誤った値で算定されるより安全側に倒れている）。
 */
export const PROVISIONAL_FALLBACK_YEARS = 1;

/**
 * 取得対象の applicableYear 群に、暫定適用の候補となる過年度を足す。
 * 係数を DB から引く側（算定バッチ・入力フォーム）が使う。実際にどの年度を適用するかの判定は
 * 純粋コア（effectiveYearsFor）に委ねるため、ここでは候補を落とさず広めに取るだけ。
 */
export const withProvisionalYears = (applicableYears: number[]): number[] =>
  uniqueSortedYears(
    applicableYears.flatMap((year) =>
      Array.from({ length: PROVISIONAL_FALLBACK_YEARS + 1 }, (_, back) => year - back),
    ),
  );

/**
 * 「公表済みか」の判定（officialYearIndex）に必要な最小限の係数情報。
 * 暫定適用の解消検知（isSupersededProvisionalFactor）は算定バッチのように全カラムを引かず、
 * 公表状況の判定に要る 4 列だけを取得するため、判定側は EmissionFactorRow 全体を要求しない。
 */
export type FactorPublicationRow = Pick<
  EmissionFactorRow,
  'energyType' | 'applicableYear' | 'isCustom' | 'status'
>;

/**
 * energyType ごとの「公式係数が存在する applicableYear」一覧（降順）。
 * resolveEmissionFactor はレコード単位で呼ばれるため、同じ係数配列に対しては一度だけ組み立てて
 * 使い回す（バッチ算定で数千レコード × 数千係数の走査になるのを防ぐ）。
 */
const officialYearIndexCache = new WeakMap<FactorPublicationRow[], Map<string, number[]>>();

const officialYearIndex = (factors: FactorPublicationRow[]): Map<string, number[]> => {
  const cached = officialYearIndexCache.get(factors);
  if (cached) {
    return cached;
  }

  const index = new Map<string, number[]>();
  for (const factor of factors) {
    // カスタム係数は暫定適用の対象外なので「公表済みか」の判定にも入れない
    // （組織が年度ごとに登録するもので、前年度の値を黙って流用すると
    // 「登録をやめた」意図と区別できない）。
    if (factor.isCustom || factor.status !== 'active') {
      continue;
    }
    const years = index.get(factor.energyType);
    if (!years) {
      index.set(factor.energyType, [factor.applicableYear]);
    } else if (!years.includes(factor.applicableYear)) {
      years.push(factor.applicableYear);
    }
  }
  for (const years of index.values()) {
    years.sort((a, b) => b - a);
  }

  officialYearIndexCache.set(factors, index);
  return index;
};

/**
 * レコードの温対法年度（deriveApplicableYear）がまだ未公表のときに暫定適用してよい過年度。
 * 未公表でない、または遡れる範囲（PROVISIONAL_FALLBACK_YEARS）に公式係数が無ければ null。
 *
 * 「未公表か」は会計年度の開始年ではなく **その月の温対法年度だけ** で見る。
 * 公式係数の有効期間は温対法年度（4月〜翌3月）で切られているため、その月を有効期間で
 * カバーできるのは同じ温対法年度の係数だけで、会計年度の開始年の係数が別にあっても
 * その月は算定できない。開始年との交差で判定すると、非4月始まりの会計年度が温対法年度を
 * またいだ後の月（例: 7月始まり FY2025 の 2026年4〜6月）が「公表済み」と誤判定され、
 * 暫定適用が発動しないまま正式係数の公表まで未算定になる。
 */
const provisionalYearFor = (
  published: number[] | undefined,
  targetYear: number,
): number | null => {
  if (!published || published.includes(targetYear)) {
    return null;
  }
  // published は降順。遡れる範囲で最も新しい年度を選ぶ。
  return published.find(
    (year) => year < targetYear && year >= targetYear - PROVISIONAL_FALLBACK_YEARS,
  ) ?? null;
};

/**
 * レコードが参照してよい applicableYear 群と、そのうち暫定適用として扱う年度。
 * years は通常は applicableYearsForRecord そのもの。温対法年度の公式係数が 1 件も無い
 * energyType に限り、直近の過年度（PROVISIONAL_FALLBACK_YEARS の範囲）を**追加**する（＝暫定適用）。
 *
 * 年度を「選び直す」のではなく「足すだけ」にしているのが要:
 * この前提フィルタは自動解決と明示指定の両方が通るため、年度を差し替えると
 * 「いま解決できている係数が候補から外れる」経路ができてしまう。足すだけなら、
 * 増えるのは下位 tier の候補だけで、勝者・曖昧判定・単位不一致判定はいずれも
 * 最上位 tier の中だけを見るため結果が変わらない。
 *
 * provisionalYear は基準年度（applicableYearsForRecord）にすでに含まれることがある。
 * 非4月始まりの会計年度がまたいだ後の月は基準年度が {開始年, 温対法年度} の 2 年になり、
 * 暫定適用する開始年側は「候補年度としてはもともと通るが、有効期間で弾かれる」状態にあるため、
 * 年度を足すだけでは足りず、有効期間チェックの免除対象を別に持つ必要がある（matchesBaseFilter）。
 */
interface EffectiveYears {
  years: number[];
  /** 暫定適用ぶんを足す前の基準年度（applicableYearsForRecord）。カスタム係数はここにしか乗れない */
  baseYears: number[];
  /** 有効期間チェックを免除して暫定適用する applicableYear。暫定適用しないなら null */
  provisionalYear: number | null;
}

const effectiveYearsFor = (
  factors: EmissionFactorRow[],
  record: FactorResolutionRecord,
  context: FactorResolutionContext,
): EffectiveYears => {
  const base = applicableYearsForRecord(record.periodStart, context.applicableYear);
  const published = officialYearIndex(factors).get(record.energyType);
  const provisionalYear = provisionalYearFor(published, deriveApplicableYear(record.periodStart));
  return {
    years: provisionalYear === null ? base : uniqueSortedYears([...base, provisionalYear]),
    baseYears: base,
    provisionalYear,
  };
};

/**
 * 適用した係数が「対象年度の公表待ちにより過年度から流用したもの」か。
 * 画面の暫定表示（手動入力の係数詳細・入力プレビュー）で使う。
 *
 * 公式係数の有効期間は温対法年度で切られているため、レコードの温対法年度より古い年度の
 * 公式係数が採用されているなら、それは有効期間チェックを免除された暫定適用しかあり得ない
 * （matchesBaseFilter）。カスタム係数は暫定適用の対象外なので常に false。
 */
export const isProvisionalFactor = (
  factor: Pick<EmissionFactorRow, 'applicableYear' | 'isCustom'>,
  periodStart: string,
): boolean => !factor.isCustom && factor.applicableYear < deriveApplicableYear(periodStart);

/**
 * 暫定適用で算定した結果が「対象年度の公式係数が公表されたことで古くなった」か。
 * 算定済みレコード（emission_results）に適用済みの係数と、いまの係数集合を突き合わせて判定する。
 *
 * 算定バッチは isCalculated = false のレコードしか処理しないため、暫定適用で算定した結果は
 * 正式係数が公表・投入されても自動では置き換わらない。この関数で該当レコードを洗い出し、
 * 再算定対象（isCalculated = false）へ戻す。
 *
 * 判定は effectiveYearsFor の分岐と対になっている（片方だけ直すと検知漏れ・空振りになる）:
 *   - 適用した係数の applicableYear がレコードの温対法年度より古い
 *     ＝ 算定時に暫定適用だった（isProvisionalFactor）
 *   - いまその energyType の公式係数がレコードの温対法年度に存在する ＝ 暫定適用はすでに解消している
 *     （provisionalYearFor が null を返すようになり、再算定すれば正式係数が選ばれる）
 *
 * カスタム係数は暫定適用の対象外（isProvisionalFactor が false を返す）なのでここでも対象外。
 */
export const isSupersededProvisionalFactor = (
  appliedFactor: Pick<EmissionFactorRow, 'applicableYear' | 'isCustom'>,
  record: Pick<FactorResolutionRecord, 'energyType' | 'periodStart'>,
  currentFactors: FactorPublicationRow[],
): boolean => {
  if (!isProvisionalFactor(appliedFactor, record.periodStart)) {
    return false;
  }
  const published = officialYearIndex(currentFactors).get(record.energyType);
  return published !== undefined && published.includes(deriveApplicableYear(record.periodStart));
};

/** 係数の有効期間（effectiveFrom/To）内に対象期間開始日が含まれるか。null は開区間。 */
const isWithinEffectivePeriod = (
  factor: EmissionFactorRow,
  periodStart: string,
): boolean => {
  if (factor.effectiveFrom && periodStart < factor.effectiveFrom) {
    return false;
  }
  if (factor.effectiveTo && periodStart > factor.effectiveTo) {
    return false;
  }
  return true;
};

/**
 * 係数がどの優先度段階に該当するかを返す（該当しなければ Infinity）。数値が小さいほど高優先。
 * 1: 拠点固有カスタム / 2: サプライヤー固有 / 3: 組織全体カスタム / 4: 地域一致標準 / 5: 全国標準
 */
const tierOf = (
  factor: EmissionFactorRow,
  record: FactorResolutionRecord,
  context: FactorResolutionContext,
): number => {
  if (factor.isCustom) {
    if (factor.locationId === record.locationId) {
      return 1;
    }
    // 2. サプライヤー固有カスタム:
    //    Phase1 では activity_records にサプライヤー紐付けが無く、レコードと突き合わせられないため
    //    ここでは決してヒットさせない（供給者紐付けが入る Phase2 で record.supplierId と比較して復活させる）。
    if (factor.locationId === null && factor.supplierId === null) {
      return 3;
    }
    return Infinity;
  }
  // 事業者別係数（providerName あり）は自動解決の対象外（明示選択専用）。
  // tier に入れると候補セレクトに数百事業者×メニューが並んでしまうため、
  // 契約先を選ばない場合のフォールバックは代替値（providerName なしの全国標準）に限る。
  if (factor.providerName !== null) {
    return Infinity;
  }
  if (context.regionName != null && factor.regionName === context.regionName) {
    return 4;
  }
  if (factor.regionName === REGION_NAME_NATIONWIDE) {
    return 5;
  }
  return Infinity;
};

/**
 * 前提フィルタ: energyType一致・applicableYear一致・status='active'・有効期間内。
 * applicableYear は「会計年度の開始年」と「periodStart の温対法年度」のどちらかに一致すればよい
 * （applicableYearsForRecord）。会計年度の開始年だけに固定すると非4月始まりの組織で公式係数が
 * 有効期間外になり、温対法年度だけに固定すると有効期間を持たないカスタム係数（会計年度の開始年で
 * 登録される）が年度境界で外れる。
 * effectiveYears には、温対法年度の公式係数が未公表の energyType に限り暫定適用する過年度が
 * 足されている（effectiveYearsFor）。この追加ぶんは公式係数のためのものなので、カスタム係数は
 * 足す前の基準年度（baseYears）だけで突き合わせる（カスタム係数は暫定適用しない）。
 * 暫定適用する年度の係数は effectiveTo が過年度末を指すため、有効期間の判定は暫定適用の年度以外に
 * だけ行う（暫定適用を有効期間で弾かない）。免除は「基準年度に無い年度か」ではなく provisionalYear
 * との一致で見る: 非4月始まりの会計年度がまたいだ後の月は暫定適用する開始年が基準年度にも
 * 含まれるため、前者では免除が効かない（このときカスタム係数は基準年度側の一致で従来どおり通る）。
 */
const matchesBaseFilter = (
  factor: EmissionFactorRow,
  record: FactorResolutionRecord,
  effectiveYears: EffectiveYears,
): boolean => {
  if (factor.energyType !== record.energyType || factor.status !== 'active') {
    return false;
  }
  // カスタム係数は暫定適用の対象外なので、暫定適用ぶんを足す前の基準年度だけで突き合わせる。
  // years で見ると、公式係数のために足した provisionalYear に前年のカスタム係数が便乗し、
  // 上位 tier（拠点固有・組織全体）として公式係数の暫定適用に勝ってしまう。
  const allowedYears = factor.isCustom ? effectiveYears.baseYears : effectiveYears.years;
  if (!allowedYears.includes(factor.applicableYear)) {
    return false;
  }
  // 暫定適用する年度の公式係数は effectiveTo が過年度末を指すため、有効期間の判定を免除する。
  const isProvisional =
    !factor.isCustom && factor.applicableYear === effectiveYears.provisionalYear;
  return isProvisional || isWithinEffectivePeriod(factor, record.periodStart);
};

/**
 * 係数集合のうち、このレコードで前提フィルタ（matchesBaseFilter）を通るものだけを返す。
 * 対象年度が公表済みかは渡した係数集合全体（標準係数 ∪ 事業者係数）で判定する（effectiveYearsFor）。
 *
 * 入力フォームが取得する係数は暫定適用のためフォールバック年度も含む（withProvisionalYears）。
 * 対象年度が公表済みなら過年度の行は算定で採用されないのに、そのまま画面に並べると
 * 同じ事業者・同じメニューの行が年度違いで重複し、どちらを選んだかで明示指定が前提フィルタを
 * 通ったり通らなかったりする。表示・選択の元集合をこの関数で絞り、算定バッチと同じ判定に揃える。
 */
export const filterApplicableFactors = <T extends EmissionFactorRow>(
  factors: T[],
  record: FactorResolutionRecord,
  context: FactorResolutionContext,
): T[] => {
  const effectiveYears = effectiveYearsFor(factors, record, context);
  return factors.filter((factor) => matchesBaseFilter(factor, record, effectiveYears));
};

/**
 * 同一優先度内の並び順キー（小さいほど先頭）。
 *   1. factorType='adjusted'（調整後排出係数）を優先（温対法の報告実務では調整後を用いるのが通例）
 *   2. applicableYear が会計年度の開始年と一致する係数を優先
 *      （非4月始まりの組織が年度ごとに登録した有効期間なしのカスタム係数が、年度境界の月で
 *        翌年度分と同時にヒットしたとき、組織の会計年度に属する側を採る）
 * 候補が「同じ順位」かどうかの判定（isAmbiguousChoice）にも使うため、id を含めない。
 */
const rankWithinTier = (factor: EmissionFactorRow, context: FactorResolutionContext): number =>
  (factor.factorType === 'adjusted' ? 0 : 2) + (factor.applicableYear === context.applicableYear ? 0 : 1);

/**
 * 適用候補となる排出係数を優先順位に従って並べて返す（先頭 = 自動選択される係数）。
 * 手動入力・CSVプレビューの候補セレクトと resolveEmissionFactor が同じ並びを共有し、
 * 画面に表示した係数と実際の算定で使う係数がずれないようにする。
 *
 * 並び順: 優先度(tier)昇順 → 同一優先度では factorType='adjusted'（調整後排出係数）を優先
 * （温対法の報告実務では調整後を用いるのが通例のため）→ 会計年度の開始年と同じ applicableYear を優先
 * （rankWithinTier）→ id 昇順。
 * DBの行返却順に依存すると再算定で結果が変わるため、id で安定ソートする（再現性担保）。
 */
export const listFactorCandidates = <T extends EmissionFactorRow>(
  record: FactorResolutionRecord,
  factors: T[],
  context: FactorResolutionContext,
): T[] => {
  // 前提フィルタを満たし、いずれかの優先度段階に該当する（tier が有限の）係数だけを候補にする。
  const candidates: Array<{ factor: T; tier: number }> = [];
  const effectiveYears = effectiveYearsFor(factors, record, context);

  for (const factor of factors) {
    if (!matchesBaseFilter(factor, record, effectiveYears)) {
      continue;
    }

    const tier = tierOf(factor, record, context);
    if (tier === Infinity) {
      continue;
    }
    candidates.push({ factor, tier });
  }

  return candidates
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        rankWithinTier(a.factor, context) - rankWithinTier(b.factor, context) ||
        (a.factor.id < b.factor.id ? -1 : a.factor.id > b.factor.id ? 1 : 0),
    )
    .map((entry) => entry.factor);
};

/**
 * 候補先頭の自動選択が「当てずっぽう」になるか。
 * 先頭と同じ優先度・同じ順位キー（調整後/年度）の候補が複数あり、かつ名称が異なる場合は
 * 別物の係数（例: fuel_heavy_oil の「A重油」と「B・C重油」、fuel_coal の炭種 6 種）から id 順で
 * 選ぶことになり、どれが正しいかはレコードの内容でしか決まらない。
 * 名称まで同じ候補（同名の重複登録）は id 順で決めても結果が変わらないため曖昧とはしない。
 * 全国の電気・都市ガス・熱の代替値は各 1 行（providerName なし）なので、この判定で外れることはない。
 */
export const isAmbiguousChoice = (
  candidates: readonly EmissionFactorRow[],
  record: FactorResolutionRecord,
  context: FactorResolutionContext,
): boolean => {
  const [head, ...rest] = candidates;
  if (!head) {
    return false;
  }
  const headTier = tierOf(head, record, context);
  const headRank = rankWithinTier(head, context);
  return rest.some(
    (factor) =>
      tierOf(factor, record, context) === headTier &&
      rankWithinTier(factor, context) === headRank &&
      factor.name !== head.name,
  );
};

/**
 * 活動量の単位から係数の単位へ換算できるか。record.unit が無ければ常に true（単位で絞らない）。
 * 換算可否の判定は算定本体（computeEmissions）と同じ resolveUnitConversion を使い、
 * 「選んだのに換算できない」ずれを作らない。
 * 空文字の unit は「単位なし」扱いにしない（意図的）。空文字はどの係数にも換算できないので
 * 絞り込みをスキップしても直後の換算で必ず失敗し、結果は同じ UNIT_MISMATCH になる。
 * 「単位が空で換算できない」と正しく報告する方がよい（DB は NOT NULL だが空文字の CHECK は無い）。
 */
const isUnitCompatible = (factor: EmissionFactorRow, record: FactorResolutionRecord): boolean =>
  record.unit == null || resolveUnitConversion(record.unit, factor.unit) !== null;

/**
 * 事業者名の突き合わせキー。前後の空白ゆらぎで別事業者と判定されないようにする
 * （data-input 側の normalizeProviderName と同じ規則。純粋コアは feature 層に依存しないため再掲）。
 */
const providerKey = (providerName: string | null): string => providerName?.trim() ?? '';

/**
 * 明示指定された事業者別係数が前提フィルタを外れたとき、同一事業者・同一メニュー・同一係数種別の
 * 別年度の行へ読み替える。
 * 事業者別係数は自動解決の候補外（tierOf = Infinity）なので、明示指定が年度更新で前提フィルタを
 * 外れると、そのまま自動解決へ落とせば全国の代替値へ置き換わる。契約先の実係数と全国平均では値が
 * 大きく異なり報告根拠として説明できないため、まず「同じ事業者の当年度行」を探して選択の意図を保つ。
 * 典型例: 対象年度が未公表の間に過年度の事業者係数を暫定適用で保存し、その後に対象年度が公表されて
 * 暫定適用が解消された（過年度行が前提フィルタを通らなくなった）レコード。
 */
const remapProviderFactor = (
  requested: EmissionFactorRow,
  record: FactorResolutionRecord,
  factors: EmissionFactorRow[],
  context: FactorResolutionContext,
  effectiveYears: EffectiveYears,
): EmissionFactorRow | null => {
  const requestedProvider = providerKey(requested.providerName);
  if (!requestedProvider) {
    return null;
  }

  const matches = factors.filter(
    (factor) =>
      factor.id !== requested.id &&
      // 読み替えは「年度更新で行が入れ替わった」場合に限る。同一年度内の別行へ移すのは
      // 事業者選択の意味が変わるだけでなく、Scope3 の IDEA 正規化行（providerName='IDEA' で
      // 年度が全行同じ）が互いにマッチする経路を作ってしまう（docs/idea-scope3-spec.md §4.3-2）。
      factor.applicableYear !== requested.applicableYear &&
      providerKey(factor.providerName) === requestedProvider &&
      // 同名の別事業者を取り違えないよう、双方に登録番号があるときは一致も必須にする。
      (factor.providerNumber === null ||
        requested.providerNumber === null ||
        factor.providerNumber === requested.providerNumber) &&
      factor.menuName === requested.menuName &&
      factor.factorType === requested.factorType &&
      matchesBaseFilter(factor, record, effectiveYears),
  );

  // 非4月始まりの会計年度では前提フィルタが 2 年度を許容するため、有効期間なしのカスタム事業者係数は
  // 複数年度ぶん残り得る。id だけで先頭を採ると会計年度と違う年度の行へ黙って読み替わるので、
  // 自動解決と同じ rankWithinTier（会計年度の開始年と一致する行を優先）を先に見てから id で安定させる
  // （listFactorCandidates と同じ方針。候補が 1 年度しか残らない通常ケースでは挙動は変わらない）。
  return (
    matches.sort(
      (a, b) =>
        rankWithinTier(a, context) - rankWithinTier(b, context) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0] ?? null
  );
};

/** 係数解決がどう決まったか。明示指定が使われなかったことを呼び出し側へ伝えるために返す。 */
export type FactorResolutionKind =
  /** 明示指定なし。優先順位による自動解決 */
  | 'auto'
  /** 明示指定をそのまま適用 */
  | 'explicit'
  /** 明示指定が前提フィルタを外れ、同一事業者・同一メニューの別年度行へ読み替えた */
  | 'explicit_remapped'
  /** 明示指定が使えず、優先順位による自動解決へフォールバックした */
  | 'explicit_fallback';

/**
 * 係数解決の詳細結果。
 *   resolved:      適用する係数が決まった。kind に決まり方、requestedFactorId に「指定どおりには
 *                  使えなかった明示指定の係数ID」（kind が explicit_remapped / explicit_fallback の
 *                  ときだけ非 null）を持ち、呼び出し側が警告として利用者へ提示する
 *   ambiguous:     候補が複数あり自動では決められない（明示選択が必要）
 *   unit_mismatch: 最上位の優先度段階に該当する係数はあるが、どれも活動量の単位から換算できない。
 *                  candidates はその段階で弾かれた係数（呼び出し側が単位を提示するため）
 */
export type FactorResolution =
  | {
      status: 'resolved';
      factor: EmissionFactorRow;
      kind: FactorResolutionKind;
      requestedFactorId: string | null;
    }
  | { status: 'not_found' }
  | { status: 'ambiguous'; candidates: EmissionFactorRow[] }
  | { status: 'unit_mismatch'; candidates: EmissionFactorRow[] };

/** 明示指定が使えなかった（または無かった）ときの、優先順位による自動解決。 */
const resolveAutomatically = (
  record: FactorResolutionRecord,
  factors: EmissionFactorRow[],
  context: FactorResolutionContext,
  origin: Pick<Extract<FactorResolution, { status: 'resolved' }>, 'kind' | 'requestedFactorId'>,
): FactorResolution => {
  const candidates = listFactorCandidates(record, factors, context);
  if (candidates.length === 0) {
    return { status: 'not_found' };
  }

  // 単位互換で絞る（並び順は listFactorCandidates のまま保つ）。絞った先頭が元の先頭と同じ優先度段階に
  // 無ければ、最上位段階の係数はすべて換算不能ということなので下位段階へは落ちず unit_mismatch。
  const topTier = tierOf(candidates[0], record, context);
  const compatible = candidates.filter((factor) => isUnitCompatible(factor, record));
  if (compatible.length === 0 || tierOf(compatible[0], record, context) !== topTier) {
    return {
      status: 'unit_mismatch',
      candidates: candidates.filter((factor) => tierOf(factor, record, context) === topTier),
    };
  }
  if (isAmbiguousChoice(compatible, record, context)) {
    return { status: 'ambiguous', candidates: compatible };
  }
  return { status: 'resolved', factor: compatible[0], ...origin };
};

/**
 * 活動量レコードに適用する排出係数を優先順位に従って解決する。
 * レコードに emissionFactorId の明示指定があり、それが前提フィルタ
 * （energyType・applicableYear・active・有効期間）を満たせば最優先で使う。
 * 事業者別係数（providerName あり）は自動候補には並ばないため、候補リストではなく
 * 前提フィルタ通過済みの全係数に対して照合する（手動入力で選択した供給事業者の
 * 係数を保存後の算定でも確実に使うため）。
 * 明示指定が使えない場合（保存後に係数がアーカイブされた・対象年度が公表されて暫定適用が
 * 解消された等）は、事業者別係数なら同一事業者・同一メニューの当年度行へ読み替え
 * （remapProviderFactor）、それも無ければ自動解決へフォールバックする。いずれの場合も kind と
 * requestedFactorId で「指定どおりには使われなかった」ことが分かるようにし、呼び出し側
 * （computeEmissions）が警告として利用者へ提示する。
 * 見つからなければ not_found、候補が複数あって当てずっぽうになる場合（isAmbiguousChoice）は
 * ambiguous を返す（呼び出し側で未算定として扱う）。
 *
 * 自動解決で record.unit が与えられている場合は、候補のうち活動量の単位から換算できる係数だけを
 * 採用対象にする。同じ優先度段階には単位の異なる係数が混在し得る（例: energyType='fuel' の
 * 公式係数は tCO2/t・tCO2/千m3・tCO2/kL が同居）ため、先頭 1 件だけを試すと id 順という偶然で
 * UNIT_MISMATCH になる。ただし単位互換で見るのは最上位の優先度段階の中だけで、
 * 上位段階（拠点カスタム等）を単位不一致で飛ばして下位段階（全国標準等）へ落ちることはしない
 * （組織が意図して登録した係数を黙って別の係数に差し替えないため）。その場合は unit_mismatch を返す。
 * 明示指定の係数は単位に関係なく採用する（換算できなければ呼び出し側で UNIT_MISMATCH にする）。
 */
export const resolveEmissionFactorDetailed = (
  record: FactorResolutionRecord,
  factors: EmissionFactorRow[],
  context: FactorResolutionContext,
): FactorResolution => {
  if (record.emissionFactorId) {
    const requestedFactorId = record.emissionFactorId;
    const effectiveYears = effectiveYearsFor(factors, record, context);
    // アーカイブ済みの係数は取得段階（status='active'）で除かれ、ここには現れない（＝読み替えもできない）。
    const requested = factors.find((factor) => factor.id === requestedFactorId) ?? null;
    if (requested && matchesBaseFilter(requested, record, effectiveYears)) {
      return { status: 'resolved', factor: requested, kind: 'explicit', requestedFactorId: null };
    }
    if (requested) {
      const remapped = remapProviderFactor(requested, record, factors, context, effectiveYears);
      if (remapped) {
        return { status: 'resolved', factor: remapped, kind: 'explicit_remapped', requestedFactorId };
      }
    }
    return resolveAutomatically(record, factors, context, {
      kind: 'explicit_fallback',
      requestedFactorId,
    });
  }

  return resolveAutomatically(record, factors, context, { kind: 'auto', requestedFactorId: null });
};

/**
 * resolveEmissionFactorDetailed の簡易版。適用する係数だけを返し、見つからない・曖昧・単位不一致の場合は null。
 * 理由を区別して扱う呼び出し側（算定バッチの未解決理由、入力フォームの案内）は詳細版を使う。
 */
export const resolveEmissionFactor = (
  record: FactorResolutionRecord,
  factors: EmissionFactorRow[],
  context: FactorResolutionContext,
): EmissionFactorRow | null => {
  const resolution = resolveEmissionFactorDetailed(record, factors, context);
  return resolution.status === 'resolved' ? resolution.factor : null;
};
