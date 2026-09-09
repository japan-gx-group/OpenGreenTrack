import { describe, expect, it } from 'vitest';
import {
  BASE_YEAR_EMISSIONS_MISSING_MESSAGE,
  MAX_REDUCTION_PERCENT,
  buildAnnualProgress,
  buildAnnualStatusBadge,
  buildProgressBarView,
  buildTargetYearRange,
  buildTargetsByYear,
  calculateChangeFromBaseYear,
  calculateTargetEmissions,
  formatChangeFromBaseYear,
  getChangeFromBaseYearTone,
  getCurrentFiscalYearStartYear,
  getFiscalYearStartYearFromDate,
  getTargetFiscalYearStartYear,
  isBaseYearEmissionsUsable,
  isValidReductionPercentInput,
  parseReductionPercentInput,
  toNumber,
} from '../targetAggregation';

describe('toNumber', () => {
  it('数値文字列・null を安全に数値化する', () => {
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber(3)).toBe(3);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('not-a-number')).toBe(0);
  });
});

describe('isBaseYearEmissionsUsable', () => {
  it('正の実績だけを削減率の分母として使える', () => {
    expect(isBaseYearEmissionsUsable(100000)).toBe(true);
    expect(isBaseYearEmissionsUsable(0.001)).toBe(true);
  });

  it('0・負・未取得（null）・非有限は使えない（全年度の目標が 0 になり「未達」だらけになるため）', () => {
    expect(isBaseYearEmissionsUsable(0)).toBe(false);
    expect(isBaseYearEmissionsUsable(-1)).toBe(false);
    expect(isBaseYearEmissionsUsable(null)).toBe(false);
    expect(isBaseYearEmissionsUsable(Number.NaN)).toBe(false);
    expect(isBaseYearEmissionsUsable(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('案内文は「基準年度の算定を先に行う」ことを伝える', () => {
    expect(BASE_YEAR_EMISSIONS_MISSING_MESSAGE).toContain('基準年度の実績が 0');
    expect(BASE_YEAR_EMISSIONS_MISSING_MESSAGE).toContain('算定');
  });
});

describe('isValidReductionPercentInput / parseReductionPercentInput', () => {
  it('空欄は「未設定」として有効、parse すると null になる', () => {
    expect(isValidReductionPercentInput('')).toBe(true);
    expect(isValidReductionPercentInput('  ')).toBe(true);
    expect(parseReductionPercentInput('')).toBeNull();
  });

  it('0〜100 の数値は有効', () => {
    expect(isValidReductionPercentInput('46')).toBe(true);
    expect(isValidReductionPercentInput('0')).toBe(true);
    expect(isValidReductionPercentInput(String(MAX_REDUCTION_PERCENT))).toBe(true);
    expect(parseReductionPercentInput('46.5')).toBe(46.5);
  });

  it('負の値・100超・数値化できない文字列は無効', () => {
    expect(isValidReductionPercentInput('-1')).toBe(false);
    expect(isValidReductionPercentInput('101')).toBe(false);
    expect(isValidReductionPercentInput('abc')).toBe(false);
    expect(parseReductionPercentInput('-1')).toBeNull();
    expect(parseReductionPercentInput('101')).toBeNull();
  });

  it('小数3桁以上はDB側（numeric(5,2)）で2桁に黙って丸まるため無効にする', () => {
    expect(isValidReductionPercentInput('46.25')).toBe(true);
    expect(isValidReductionPercentInput('46.255')).toBe(false);
    expect(parseReductionPercentInput('46.25')).toBe(46.25);
    expect(parseReductionPercentInput('46.255')).toBeNull();
  });

  it('指数表記・符号付き・小数点のみの表記は無効', () => {
    expect(isValidReductionPercentInput('1e2')).toBe(false);
    expect(isValidReductionPercentInput('+5')).toBe(false);
    expect(isValidReductionPercentInput('.5')).toBe(false);
    expect(isValidReductionPercentInput('5.')).toBe(false);
  });
});

describe('getCurrentFiscalYearStartYear / getTargetFiscalYearStartYear', () => {
  it('期首月以降の月はその年、期首月より前の月は前年が「現在の年度」になる', () => {
    // 期首4月: 2026-04-01 は 2026年度、2026-03-31 はまだ 2025年度。
    expect(getCurrentFiscalYearStartYear(new Date('2026-04-01T00:00:00'), 4)).toBe(2026);
    expect(getCurrentFiscalYearStartYear(new Date('2026-03-31T00:00:00'), 4)).toBe(2025);
  });

  it('期首月が1月（暦年と一致）ならその年がそのまま現在の年度になる', () => {
    expect(getCurrentFiscalYearStartYear(new Date('2026-01-01T00:00:00'), 1)).toBe(2026);
  });

  it('期首月が未指定・不正な場合は既定の4月として扱う', () => {
    expect(getCurrentFiscalYearStartYear(new Date('2026-03-31T00:00:00'), null)).toBe(2025);
  });

  it('目標年度は現在の年度 + 5年', () => {
    expect(getTargetFiscalYearStartYear(new Date('2026-09-04T00:00:00'), 4)).toBe(2031);
  });
});

describe('getFiscalYearStartYearFromDate / buildTargetYearRange', () => {
  it('年度の開始日から開始年を取り出す', () => {
    expect(getFiscalYearStartYearFromDate('2026-04-01')).toBe(2026);
  });

  it('基準年度の翌年度から最終目標年度までを列挙する（基準年度自身は含めない）', () => {
    expect(buildTargetYearRange(2023, 2027)).toEqual([2024, 2025, 2026, 2027]);
  });

  it('基準年度が最終目標年度以降なら空配列（入力できる年度が無い）', () => {
    expect(buildTargetYearRange(2031, 2031)).toEqual([]);
    expect(buildTargetYearRange(2032, 2031)).toEqual([]);
  });
});

describe('buildTargetsByYear', () => {
  it('年度ごとの削減率を基準年度実績に当てて年間目標排出量に変換する', () => {
    expect(
      buildTargetsByYear(100000, [
        { targetYear: 2024, reductionPercent: 10 },
        { targetYear: 2025, reductionPercent: 25 },
      ]),
    ).toEqual({ 2024: 90000, 2025: 75000 });
  });

  it('削減率が1件も無ければ空のままにする（目標未設定の年度は線を引かない）', () => {
    expect(buildTargetsByYear(100000, [])).toEqual({});
  });
});

describe('calculateTargetEmissions', () => {
  it('基準年度の実績から削減率ぶんを引いた値を返す', () => {
    expect(calculateTargetEmissions(100000, 50)).toBe(50000);
    expect(calculateTargetEmissions(100000, 0)).toBe(100000);
    expect(calculateTargetEmissions(100000, 100)).toBe(0);
  });

  it('基準年度に排出量が無ければ目標も0になる', () => {
    expect(calculateTargetEmissions(0, 46)).toBe(0);
  });
});

describe('buildAnnualProgress', () => {
  it('年間実績が年間目標以下なら枠内、目標消化率(%)と残り枠を計算する', () => {
    const progress = buildAnnualProgress(180, 200);

    expect(progress.annualTarget).toBe(200);
    expect(progress.hasTarget).toBe(true);
    expect(progress.consumptionRate).toBe(90);
    expect(progress.remainingEmissions).toBe(20);
    expect(progress.withinTarget).toBe(true);
  });

  it('年間実績が年間目標を超えたら超過（残り枠は負）', () => {
    const progress = buildAnnualProgress(250, 200);

    expect(progress.withinTarget).toBe(false);
    expect(progress.consumptionRate).toBe(125);
    expect(progress.remainingEmissions).toBe(-50);
  });

  it('目標が未設定の年度は判定不能（null）を返す', () => {
    const progress = buildAnnualProgress(100, null);

    expect(progress.hasTarget).toBe(false);
    expect(progress.consumptionRate).toBeNull();
    expect(progress.remainingEmissions).toBeNull();
    expect(progress.withinTarget).toBeNull();
    expect(progress.annualTarget).toBeNull();
  });

  it('目標が0の年度は目標消化率を計算せず（null）、実績0なら枠内扱いにする', () => {
    const progress = buildAnnualProgress(0, 0);

    expect(progress.hasTarget).toBe(true);
    expect(progress.consumptionRate).toBeNull();
    expect(progress.remainingEmissions).toBe(0);
    expect(progress.withinTarget).toBe(true);
  });

  it('目標が0（ネットゼロ）で実績があれば、目標消化率は出せないが超過と判定する', () => {
    const progress = buildAnnualProgress(12.5, 0);

    expect(progress.hasTarget).toBe(true);
    expect(progress.consumptionRate).toBeNull();
    expect(progress.remainingEmissions).toBe(-12.5);
    expect(progress.withinTarget).toBe(false);
  });
});

describe('buildAnnualStatusBadge', () => {
  // 期中は分子（累計）が伸び続けるため「達成」と断定できない。年度終了後にだけ確定表現にする。
  it('期中で枠内なら「枠内で推移中」（達成とは言わない）', () => {
    expect(buildAnnualStatusBadge(buildAnnualProgress(90, 200), false)).toEqual({
      label: '枠内で推移中',
      tone: 'good',
    });
  });

  it('期中でも超過は確定なので「目標超過」', () => {
    expect(buildAnnualStatusBadge(buildAnnualProgress(250, 200), false)).toEqual({
      label: '目標超過',
      tone: 'bad',
    });
  });

  it('年度終了後は「達成」「未達」で確定表示する', () => {
    expect(buildAnnualStatusBadge(buildAnnualProgress(180, 200), true)).toEqual({
      label: '達成',
      tone: 'good',
    });
    expect(buildAnnualStatusBadge(buildAnnualProgress(250, 200), true)).toEqual({
      label: '未達',
      tone: 'bad',
    });
  });

  it('目標 0（ネットゼロ）でも枠内/超過の判定でピルを出す', () => {
    expect(buildAnnualStatusBadge(buildAnnualProgress(0, 0), false)?.label).toBe('枠内で推移中');
    expect(buildAnnualStatusBadge(buildAnnualProgress(12.5, 0), true)?.label).toBe('未達');
  });

  it('目標未設定ならピルを出さない（null）', () => {
    expect(buildAnnualStatusBadge(buildAnnualProgress(100, null), false)).toBeNull();
    expect(buildAnnualStatusBadge(buildAnnualProgress(100, null), true)).toBeNull();
  });
});

describe('buildProgressBarView', () => {
  it('目標内なら目標消化率ぶんを塗り、残り率を出す', () => {
    expect(buildProgressBarView(buildAnnualProgress(180, 200))).toEqual({
      filledPercent: 90,
      exceeded: false,
      overshootPercent: null,
      remainingPercent: 10,
    });
  });

  it('目標を超えたらバーは満杯で頭打ちにし、超過率を数値で出す', () => {
    expect(buildProgressBarView(buildAnnualProgress(250, 200))).toEqual({
      filledPercent: 100,
      exceeded: true,
      overshootPercent: 25,
      remainingPercent: 0,
    });
  });

  it('目標0 × 実績>0 はバー満杯の超過扱いにし、0除算になる超過率・残り率は出さない', () => {
    expect(buildProgressBarView(buildAnnualProgress(12.5, 0))).toEqual({
      filledPercent: 100,
      exceeded: true,
      overshootPercent: null,
      remainingPercent: null,
    });
  });

  it('目標0 × 実績0 は空のバーで、「残り 100%」のような残り率は出さない', () => {
    expect(buildProgressBarView(buildAnnualProgress(0, 0))).toEqual({
      filledPercent: 0,
      exceeded: false,
      overshootPercent: null,
      remainingPercent: null,
    });
  });

  it('目標未設定（hasTarget=false）で呼んでも例外にならず空のバーになる（呼び出し側でバー自体を出さない前提）', () => {
    expect(buildProgressBarView(buildAnnualProgress(100, null))).toEqual({
      filledPercent: 0,
      exceeded: false,
      overshootPercent: null,
      remainingPercent: null,
    });
  });
});

describe('calculateChangeFromBaseYear', () => {
  it('基準年度より減っていれば負、増えていれば正の増減率(%)を返す', () => {
    expect(calculateChangeFromBaseYear(1000, 877)).toBeCloseTo(-12.3);
    expect(calculateChangeFromBaseYear(1000, 1050)).toBeCloseTo(5);
    expect(calculateChangeFromBaseYear(1000, 1000)).toBe(0);
  });

  it('実績 0（ネットゼロ達成）は基準年度比 -100% になる', () => {
    expect(calculateChangeFromBaseYear(1000, 0)).toBe(-100);
  });

  it('基準年度の実績が分母として使えない（0・null）なら null を返す', () => {
    expect(calculateChangeFromBaseYear(0, 100)).toBeNull();
    expect(calculateChangeFromBaseYear(null, 100)).toBeNull();
  });
});

describe('formatChangeFromBaseYear', () => {
  it('削減は ▲、増加は + を付けて小数第1位で表示する', () => {
    expect(formatChangeFromBaseYear(-12.34)).toBe('▲12.3%');
    expect(formatChangeFromBaseYear(5)).toBe('+5.0%');
    expect(formatChangeFromBaseYear(-100)).toBe('▲100.0%');
  });

  it('小数第1位で 0 になる値は符号を付けない', () => {
    expect(formatChangeFromBaseYear(0)).toBe('±0.0%');
    expect(formatChangeFromBaseYear(-0.04)).toBe('±0.0%');
    expect(formatChangeFromBaseYear(0.04)).toBe('±0.0%');
  });
});

describe('getChangeFromBaseYearTone', () => {
  it('削減は reduced、増加は increased', () => {
    expect(getChangeFromBaseYearTone(-12.3)).toBe('reduced');
    expect(getChangeFromBaseYearTone(5)).toBe('increased');
  });

  it('表示と同じ丸め（小数第1位）で 0 になる値は unchanged にし、文言の「±0.0%」と色がずれない', () => {
    expect(getChangeFromBaseYearTone(0)).toBe('unchanged');
    expect(getChangeFromBaseYearTone(-0.04)).toBe('unchanged');
    expect(getChangeFromBaseYearTone(0.04)).toBe('unchanged');
    expect(getChangeFromBaseYearTone(-0.05)).toBe('reduced');
  });
});
