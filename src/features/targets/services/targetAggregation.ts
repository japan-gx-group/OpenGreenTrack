// KPI削減目標（reduction_targets）の入力バリデーション・年間の目標消化率計算を行う
// 純粋関数群。I/O は targetService.ts に集約し、ここでは計算ロジックのみを扱う（テスト容易性のため）。
// 目標は「基準年度 + 年度ごとの削減率(%)」で持ち、ある年度の年間目標排出量（t-CO2e）は
// 「基準年度の実績 × (1 - その年度の削減率/100)」として導出する。
// 削減率が入っていない年度は「目標未設定」として扱う。

import { normalizeFiscalYearStartMonth } from '@/lib/fiscal-year/fiscalYearPeriod';

export const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

// reduction_target_years."reductionPercent" は numeric(5,2) かつ 0〜100 の check 制約つき。
// 範囲外はDBエラー（汎用トースト）になるため、入力段階で弾く。
export const MAX_REDUCTION_PERCENT = 100;

// 0〜100 の10進数（小数は2桁まで）。指数表記（1e2等）・符号付き（+5/-5）は許可しない。
// 小数3桁以上を「DB側で2桁に黙って丸まる」のではなくバリデーションエラーにするため、
// Number() ではなく文字列パターンで小数桁数を検証する。
const REDUCTION_PERCENT_PATTERN = /^\d+(\.\d{1,2})?$/;

// 入力欄の文字列が保存可能かどうか。空欄（=未設定として許容）は valid 扱い。
export const isValidReductionPercentInput = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed === '') return true;
  return REDUCTION_PERCENT_PATTERN.test(trimmed) && Number(trimmed) <= MAX_REDUCTION_PERCENT;
};

// 入力欄の文字列を保存用の数値に変換する。空欄は「未設定」を意味する null を返す。
// 不正な入力（負の値・100超・小数3桁以上・数値化不能）は null を返す。
export const parseReductionPercentInput = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return isValidReductionPercentInput(trimmed) ? Number(trimmed) : null;
};

/** 目標年度は「現在の年度 + 5年」。保存はせず、表示のたびに導出する（毎年ずれる）。 */
export const TARGET_YEARS_AHEAD = 5;

// 今日が属する会計年度の開始年（例: 期首4月・2026-03-31 なら 2025）。
// 「現在の年度」は DB のフラグではなく今日の日付から導出する（表示上の「現在」を導く
// isCurrentFiscalYear と同じ考え方。fiscal_years.isCurrent 列は廃止済み）。
export const getCurrentFiscalYearStartYear = (
  today: Date,
  fiscalYearStartMonth?: number | null,
): number => {
  const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  return month >= startMonth ? year : year - 1;
};

/** 最終目標年度（現在の年度 + 5年）の開始年。削減率を入力する年度の終端になる。 */
export const getTargetFiscalYearStartYear = (
  today: Date,
  fiscalYearStartMonth?: number | null,
): number => getCurrentFiscalYearStartYear(today, fiscalYearStartMonth) + TARGET_YEARS_AHEAD;

/** 年度の開始年（'2026-04-01' → 2026）。年度は開始年で識別する。 */
export const getFiscalYearStartYearFromDate = (startDate: string): number =>
  Number(startDate.slice(0, 4));

// 削減率を入力する年度（基準年度の翌年度〜最終目標年度）。
// 基準年度そのものは定義上 0% のため含めない。基準年度が最終目標年度以降なら空配列を返す。
export const buildTargetYearRange = (
  baseStartYear: number,
  finalTargetStartYear: number,
): number[] => {
  if (!Number.isInteger(baseStartYear) || !Number.isInteger(finalTargetStartYear)) return [];
  return Array.from(
    { length: Math.max(finalTargetStartYear - baseStartYear, 0) },
    (_, index) => baseStartYear + index + 1,
  );
};

// 基準年度の実績が 0（未算定・活動量なし）だと、削減率をいくつにしても全年度の目標が 0 になり、
// 実績が 1 でもあれば「未達」、達成率も判定不能になる。目標として意味を持たないため、
// 保存時に弾き、保存済みの目標でも表示側でこの注記に切り替える。
export const BASE_YEAR_EMISSIONS_MISSING_MESSAGE =
  '基準年度の実績が 0 のため目標を計算できません。先に基準年度の算定を行ってください';

/** 基準年度の実績が削減率の分母として使えるか（正の有限値か）。 */
export const isBaseYearEmissionsUsable = (baseYearEmissions: number | null): boolean =>
  baseYearEmissions !== null && Number.isFinite(baseYearEmissions) && baseYearEmissions > 0;

// 目標排出量の分母は「基準年度の通年実績」。まだ終了していない年度（期中・未来）を基準年度にすると、
// 基準年度の実績は表示のたびに引き直すため、月々の入力に合わせて分母が増え、保存済みの設定のまま
// 各年度の目標排出量が後から動く（保存時に確認した目標値と、後日カード・年度別グラフに出る値が食い違う）。
// 選択そのものを禁じると、初期セットアップ直後の組織は期中の年度しか持たず目標を一切設定できなくなるため、
// 選べるままにして、設定モーダルとカードの両方でこの注意書きを出す。
export const buildUnendedBaseYearNotice = (baseFiscalYearLabel: string): string =>
  `${baseFiscalYearLabel}はまだ終了していないため、実績の確定に伴い各年度の目標排出量が変わります`;

// 年間目標排出量（t-CO2e）。基準年度の実績からその年度の削減率ぶんを引いた値。
export const calculateTargetEmissions = (
  baseYearEmissions: number,
  reductionPercent: number,
): number => baseYearEmissions * (1 - reductionPercent / 100);

// 実績の基準年度比の増減率（%）。負 = 基準年度より減った、正 = 増えた。
// 「目標が基準年度比◯%削減」に対して「実績は基準年度比でどれだけ減ったか」を同じ物差しで
// 見せるための値。基準年度の実績が分母として使えない（0・未算定）ときは null。
export const calculateChangeFromBaseYear = (
  baseYearEmissions: number | null,
  actual: number,
): number | null => {
  if (!isBaseYearEmissionsUsable(baseYearEmissions)) return null;
  const base = baseYearEmissions as number;
  return ((actual - base) / base) * 100;
};

// 増減率の表示は小数第1位まで。符号（削減／増加／変化なし）の判定も表示と同じ丸めで行い、
// 「▲0.0%」と出ているのに増加扱い、のような文言と色のずれを起こさない。
const roundChangePercent = (changePercent: number): number =>
  Math.round(Math.abs(changePercent) * 10) / 10;

/** 基準年度比の向き。表示の色分け（削減 = 良い、増加 = 悪い、変化なし = 中立）に使う。 */
export type ChangeFromBaseYearTone = 'reduced' | 'increased' | 'unchanged';

export const getChangeFromBaseYearTone = (changePercent: number): ChangeFromBaseYearTone => {
  if (roundChangePercent(changePercent) === 0) return 'unchanged';
  return changePercent < 0 ? 'reduced' : 'increased';
};

// 基準年度比の増減率を表示用の文字列にする。削減は会計の慣例に合わせて ▲、増加は + を付ける。
// 小数第1位で丸めたうえで 0 になる場合は符号を付けない（「▲0.0%」「+0.0%」の揺れを避ける）。
export const formatChangeFromBaseYear = (changePercent: number): string => {
  const rounded = roundChangePercent(changePercent);
  const tone = getChangeFromBaseYearTone(changePercent);
  if (tone === 'unchanged') return '±0.0%';
  return `${tone === 'reduced' ? '▲' : '+'}${rounded.toFixed(1)}%`;
};

/** 年度の開始年 → 年間目標排出量。年度別グラフの目標ラインと、表示年度の目標に使う。 */
export const buildTargetsByYear = (
  baseYearEmissions: number,
  targetYears: { targetYear: number; reductionPercent: number }[],
): Record<number, number> =>
  Object.fromEntries(
    targetYears.map(entry => [
      entry.targetYear,
      calculateTargetEmissions(baseYearEmissions, entry.reductionPercent),
    ]),
  );

export type AnnualProgress = {
  /** 年間実績（累計）。t-CO2e */
  cumulativeActual: number;
  /** 年間目標。未設定は null */
  annualTarget: number | null;
  /**
   * 目標消化率（実績 / 目標 * 100）。削減目標は排出量の上限なので「目標に対して使った割合」であり、
   * 低いほど順調・100% 超で超過。一般的な「達成率」（100% に近いほど良い）とは向きが逆なので、
   * 画面でも「達成率」とは呼ばない。目標未設定・目標0の場合は null（判定不能）
   */
  consumptionRate: number | null;
  /** 残り枠（目標 − 実績）。t-CO2e。超過していれば負。目標未設定は null */
  remainingEmissions: number | null;
  hasTarget: boolean;
  /**
   * 実績が目標以下（枠内）か。削減目標のため、使い切っていないほど良い。目標未設定は null。
   * 分子が累計・分母が通年目標なので、期中の true は「達成」ではなく「枠内で推移中」
   * （年度末まで確定しない）。文言の出し分けは buildAnnualStatusBadge を参照
   */
  withinTarget: boolean | null;
};

// 年度の進捗をまとめる。cumulativeActual は呼び出し側で組み立てた年間実績合計
// （dashboard_aggregates 由来の確定値、無ければ算定結果の合算）を渡す。
export const buildAnnualProgress = (
  cumulativeActual: number,
  annualTarget: number | null,
): AnnualProgress => {
  const hasTarget = annualTarget !== null;
  const consumptionRate =
    annualTarget !== null && annualTarget > 0 ? (cumulativeActual / annualTarget) * 100 : null;

  return {
    cumulativeActual,
    annualTarget,
    consumptionRate,
    remainingEmissions: annualTarget !== null ? annualTarget - cumulativeActual : null,
    hasTarget,
    withinTarget: annualTarget !== null ? cumulativeActual <= annualTarget : null,
  };
};

/** 「達成状況」ピルの表示内容。 */
export type AnnualStatusBadge = {
  label: string;
  tone: 'good' | 'bad';
};

// 達成状況ピルの文言を、年度が終了しているかで出し分ける。
// 判定は「実績（累計）≤ 通年目標」なので、期初はほぼ必ず枠内になり、期中に「達成」と断定すると
// 「まだ半分も使っていないのに達成」の誤読を生む。期中は「枠内で推移中」にし、「達成」は年度終了後に限る。
// 一方、超過は累計が減らない以上その時点で確定するため、期中でも「目標超過」と出す
// （年度終了後は「未達」）。目標未設定（withinTarget === null）はピル自体を出さない。
export const buildAnnualStatusBadge = (
  progress: AnnualProgress,
  fiscalYearEnded: boolean,
): AnnualStatusBadge | null => {
  if (progress.withinTarget === null) return null;
  if (fiscalYearEnded) {
    return progress.withinTarget ? { label: '達成', tone: 'good' } : { label: '未達', tone: 'bad' };
  }
  return progress.withinTarget
    ? { label: '枠内で推移中', tone: 'good' }
    : { label: '目標超過', tone: 'bad' };
};

/** 進捗バー（トラック全体＝年間目標）の表示状態。 */
export type ProgressBarView = {
  /** バーの充填率（0〜100）。目標消化率が 100% を超えた分ははみ出せないので 100 で頭打ち */
  filledPercent: number;
  /** 実績が年間目標を超えているか（目標 0 × 実績 > 0 を含む） */
  exceeded: boolean;
  /** 超過分（目標消化率 − 100）。目標 0 は 0 除算で消化率が出ないため null */
  overshootPercent: number | null;
  /** 目標までの残り（100 − 充填率）。消化率が計算できない目標 0 では null */
  remainingPercent: number | null;
};

// 目標 0（ネットゼロ目標）は正当な入力だが、目標消化率（実績 ÷ 目標）は 0 除算で計算できない。
// 消化率 null をそのまま「バー 0%・残り 100%」に落とすと、実績がある年度で「超過」ピルと矛盾する
// 。消化率が無くても「実績が目標を超えているか」は判定できるので、その結果でバーを描く。
//
// 前提: 目標が設定されている年度（hasTarget === true）に対して呼ぶこと。呼び出し側はバー自体を
// 出さないためガードしている。hasTarget === false（消化率・枠内判定とも null）で呼んでも例外にはならず
// 「目標 0 × 実績 0」と同じ空のバー（filledPercent 0・残り率 null）になるが、目標未設定の表現としては
// 使わないこと。
export const buildProgressBarView = (progress: AnnualProgress): ProgressBarView => {
  const rate = progress.consumptionRate;
  const exceeded = progress.withinTarget === false;

  if (rate === null) {
    // 目標 0: 実績 > 0 なら満杯で「超過」、実績 0 なら空のバー（残り率は出せないので null）
    return {
      filledPercent: exceeded ? 100 : 0,
      exceeded,
      overshootPercent: null,
      remainingPercent: null,
    };
  }

  const filledPercent = Math.min(rate, 100);
  return {
    filledPercent,
    exceeded,
    overshootPercent: rate > 100 ? rate - 100 : null,
    remainingPercent: 100 - filledPercent,
  };
};
