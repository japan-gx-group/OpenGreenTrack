// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue } from '@/lib/testing/render';
import { buildAnnualProgress, buildUnendedBaseYearNotice } from '../../services/targetAggregation';
import type { FiscalYearRef, TargetProgressData } from '../../services/targetService';

// 削減目標カードの表示まわり3点の回帰テスト。
// 1. 目標 0（ネットゼロ）で「目標消化率 —」「目標超過」「残り 100.0%」が同時に出る矛盾を起こさない
// 2. 年度切替の再取得中は「更新中」を明示し、前年度の保存成功メッセージを持ち越さない
// 3. 目標消化率は「低いほど順調」の向きが伝わる注記を出し、「達成」は年度終了後にだけ表示する
// 4. 実績の基準年度比は、良し悪しの色を年度終了後に限る（期中は「（期中）」＋中立色、基準年度より前も中立色）
// 5. 基準年度がまだ終了していない（期中・未来）ときは、目標排出量が後から動くことをモーダルとカードで示す

const getTargetProgress = vi.fn<(...args: unknown[]) => Promise<TargetProgressData>>();
const getFiscalYearTotalEmissions = vi.fn();
const saveReductionTarget = vi.fn();
const clearReductionTarget = vi.fn();

vi.mock('../../services/targetService', () => ({
  getTargetProgress: (...args: unknown[]) => getTargetProgress(...args),
  getFiscalYearTotalEmissions: (...args: unknown[]) => getFiscalYearTotalEmissions(...args),
  saveReductionTarget: (...args: unknown[]) => saveReductionTarget(...args),
  clearReductionTarget: (...args: unknown[]) => clearReductionTarget(...args),
}));

// vi.mock はホイストされるため、モック対象を参照するコンポーネントは後から読み込む。
const { ReductionTargetCard } = await import('../ReductionTargetCard.client');

const FY2024: FiscalYearRef = { id: 'fy-2024', label: '2024年度', startDate: '2024-04-01', endDate: '2025-03-31' };
const FY2025: FiscalYearRef = { id: 'fy-2025', label: '2025年度', startDate: '2025-04-01', endDate: '2026-03-31' };
const FY2026: FiscalYearRef = { id: 'fy-2026', label: '2026年度', startDate: '2026-04-01', endDate: '2027-03-31' };
// openEdit の既定の基準年度は配列末尾（最も古い年度）。FiscalYearContext と同じ降順で渡す。
const FISCAL_YEARS = [FY2026, FY2025, FY2024];

const progressData = (
  cumulativeActual: number,
  annualTarget: number | null,
  overrides: Partial<TargetProgressData> = {},
): TargetProgressData => ({
  target: {
    baseFiscalYear: FY2024,
    baseYearEmissions: 1000,
    baseYearSource: 'aggregate',
    targetYears: [{ targetYear: 2026, reductionPercent: 100 }],
    targetsByYear: { 2026: 0 },
    currentReductionPercent: 100,
  },
  annualProgress: buildAnnualProgress(cumulativeActual, annualTarget),
  actualSource: 'aggregate',
  ...overrides,
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const cardOf = (fiscalYear: FiscalYearRef) => (
  <ReductionTargetCard
    fiscalYearId={fiscalYear.id}
    fiscalYearLabel={fiscalYear.label}
    period={{ startDate: fiscalYear.startDate, endDate: fiscalYear.endDate }}
    fiscalYears={FISCAL_YEARS}
    refreshToken={0}
  />
);
const renderCard = (fiscalYear: FiscalYearRef) => render(cardOf(fiscalYear));

const textOf = (container: HTMLElement) => container.textContent ?? '';
const statusOf = (container: HTMLElement) => container.querySelector('[role="status"]');
// React は select の value プロパティを追跡しているため、ネイティブ setter で入れてから change を流す
// （setInputValue の select 版）。
const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const dialogTextOf = (container: HTMLElement) =>
  container.querySelector('[role="dialog"]')?.textContent ?? '';
const baseYearSelectOf = (container: HTMLElement) =>
  container.querySelector<HTMLSelectElement>('#reduction-target-base-year')!;

const editButtonOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button')).find(button =>
    /目標を(変更|設定)/.test(button.textContent ?? ''),
  )!;

describe('ReductionTargetCard', () => {
  beforeEach(() => {
    // 「達成」「未達」は年度終了後にだけ出すため、今日を固定して FY2026 を期中・FY2024 を終了済みにする。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-08T12:00:00+09:00'));
    getTargetProgress.mockReset();
    getFiscalYearTotalEmissions.mockReset();
    saveReductionTarget.mockReset();
    clearReductionTarget.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('目標 0（ネットゼロ）の表示', () => {
    it('実績 > 0 なら「目標超過」+ バー満杯「目標を … 超過」にし、「残り枠 100.0%」を出さない', async () => {
      getTargetProgress.mockResolvedValue(progressData(12.5, 0));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      const text = textOf(container);
      expect(text).toContain('目標超過');
      expect(text).toContain('目標を 12.5 t-CO2e 超過');
      expect(text).not.toContain('残り枠');
      expect(text).toContain('目標が 0（ネットゼロ）のため目標消化率は計算できません');
      // 超過率は 0 除算のため数値を出さない
      expect(text).not.toMatch(/（[\d.]+%）超過/);
      unmount();
    });

    it('実績 0 なら「枠内で推移中」で、残り枠は 0 t-CO2e・率は出さない', async () => {
      getTargetProgress.mockResolvedValue(progressData(0, 0));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      const text = textOf(container);
      expect(text).toContain('枠内で推移中');
      expect(text).not.toContain('目標超過');
      expect(text).toContain('残り枠 0 t-CO2e');
      // 残り枠の率（0 除算）は出さない。基準年度比「▲100.0%」（実績 0 = 基準年度比 100% 減）は別物なので
      // 残り枠の書式（全角括弧）で絞って確認する
      expect(text).not.toMatch(/残り枠 0 t-CO2e（[\d.]+%）/);
      expect(text).toContain('2024年度比 ▲100.0%（期中）');
      unmount();
    });

    it('目標 > 0 の表示（目標消化率・超過量と超過率）', async () => {
      getTargetProgress.mockResolvedValue(progressData(250, 200));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      const text = textOf(container);
      expect(text).toContain('125.0%');
      expect(text).toContain('目標を 50 t-CO2e（25.0%）超過');
      unmount();
    });
  });

  describe('目標消化率の向きと達成状況の文言', () => {
    it('指標名は「目標消化率」で、「低いほど順調」と分かる注記を出し、「達成率」とは呼ばない', async () => {
      getTargetProgress.mockResolvedValue(progressData(90, 200));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      const text = textOf(container);
      expect(text).toContain('目標消化率');
      expect(text).toContain('45.0%');
      expect(text).toContain('目標に対して使った排出量の割合（低いほど順調）');
      expect(text).not.toContain('達成率');
      unmount();
    });

    it('期中の年度は枠内でも「達成」と言わず「枠内で推移中」にし、残り枠を t-CO2e で併記する', async () => {
      getTargetProgress.mockResolvedValue(progressData(90, 200));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      const text = textOf(container);
      expect(text).toContain('枠内で推移中');
      expect(text).not.toContain('達成');
      expect(text).toContain('残り枠 110 t-CO2e（55.0%）');
      unmount();
    });

    it('終了済みの年度は「達成」「未達」で確定表示する', async () => {
      getTargetProgress.mockResolvedValue(progressData(180, 200));
      const { container, rerender, unmount } = render(cardOf(FY2024));
      await flush();
      expect(textOf(container)).toContain('達成');
      expect(textOf(container)).not.toContain('枠内で推移中');

      getTargetProgress.mockResolvedValue(progressData(250, 200));
      rerender(cardOf(FY2025));
      await flush();
      expect(textOf(container)).toContain('未達');
      expect(textOf(container)).not.toContain('目標超過');
      unmount();
    });
  });

  describe('年度切替時の再取得', () => {
    it('再取得中は前年度の数値を残しつつ「更新中」を明示し、完了後に新年度の数値へ置き換える', async () => {
      getTargetProgress.mockResolvedValueOnce(progressData(180, 200));
      const { container, rerender, unmount } = render(cardOf(FY2026));
      await flush();
      expect(textOf(container)).toContain('90.0%');
      expect(statusOf(container)).toBeNull();

      const pending = deferred<TargetProgressData>();
      getTargetProgress.mockReturnValueOnce(pending.promise);
      rerender(cardOf(FY2025));

      // 見出しは新年度、数値は前年度のまま → 「更新中」で確定値でないことを示し、編集も止める
      expect(textOf(container)).toContain('2025年度・年間目標に対する進捗');
      expect(textOf(container)).toContain('90.0%');
      expect(statusOf(container)?.textContent).toContain('表示中の数値は前回の内容です');
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(editButtonOf(container).disabled).toBe(true);

      await act(async () => {
        pending.resolve(progressData(50, 200));
      });
      expect(textOf(container)).toContain('25.0%');
      expect(textOf(container)).not.toContain('90.0%');
      expect(statusOf(container)).toBeNull();
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      expect(editButtonOf(container).disabled).toBe(false);
      unmount();
    });

    it('保存成功メッセージは年度を切り替えた時点で消える', async () => {
      getTargetProgress.mockResolvedValue(progressData(180, 200));
      getFiscalYearTotalEmissions.mockResolvedValue({ total: 1000, source: 'aggregate' });
      saveReductionTarget.mockResolvedValue(undefined);
      const { container, rerender, unmount } = render(cardOf(FY2026));
      await flush();

      // 目標を保存して成功メッセージを出す
      click(editButtonOf(container));
      await flush();
      const percentInput = document.querySelector<HTMLInputElement>('input[id^="reduction-target-percent-"]');
      expect(percentInput).not.toBeNull();
      setInputValue(percentInput!, '10');
      click(Array.from(document.querySelectorAll('button')).find(button => button.textContent === '保存')!);
      await flush();
      await flush();
      expect(saveReductionTarget).toHaveBeenCalledTimes(1);
      expect(textOf(container)).toContain('に更新しました');

      // 年度を切り替えると、前年度の保存に対するメッセージは持ち越さない
      rerender(cardOf(FY2025));
      expect(textOf(container)).not.toContain('に更新しました');
      await flush();
      expect(textOf(container)).not.toContain('に更新しました');
      unmount();
    });
  });

  describe('実績の基準年度比', () => {
    // 色の検証は年度終了後（FY2025）で行う。期中（FY2026）は良し悪しを断定しないため常に中立色になる。
    const colorOfComparison = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('span')).find(span =>
        /年度比/.test(span.textContent ?? ''),
      )?.style.color;

    it('表示年度の実績に「基準年度比 ▲XX%」を併記する（削減は ▲）', async () => {
      getTargetProgress.mockResolvedValue(progressData(877, 900));
      const { container, unmount } = renderCard(FY2025);
      await flush();

      expect(textOf(container)).toContain('2024年度比 ▲12.3%');
      unmount();
    });

    it('基準年度より増えていれば + で表示する', async () => {
      getTargetProgress.mockResolvedValue(progressData(1050, 900));
      const { container, unmount } = renderCard(FY2025);
      await flush();

      expect(textOf(container)).toContain('2024年度比 +5.0%');
      unmount();
    });

    it('年度終了後は削減が success 色、増加は danger 色、変化なし（±0.0%）は中立色になる', async () => {
      getTargetProgress.mockResolvedValue(progressData(877, 900));
      const reduced = renderCard(FY2025);
      await flush();
      expect(colorOfComparison(reduced.container)).toBe('var(--color-success)');
      reduced.unmount();

      getTargetProgress.mockResolvedValue(progressData(1050, 900));
      const increased = renderCard(FY2025);
      await flush();
      expect(colorOfComparison(increased.container)).toBe('var(--color-danger)');
      increased.unmount();

      getTargetProgress.mockResolvedValue(progressData(1000, 900));
      const unchanged = renderCard(FY2025);
      await flush();
      expect(textOf(unchanged.container)).toContain('2024年度比 ±0.0%');
      expect(colorOfComparison(unchanged.container)).toBe('var(--color-text-muted)');
      unchanged.unmount();
    });

    // 分子＝期中累計・分母＝基準年度の通年実績のため、年度が終わるまでは実態より大きな削減に見える。
    // 期首・未入力（実績 0）が「▲100.0%」＝ネットゼロ達成の見た目で緑に出るのを防ぐ。
    it('期中の年度は「（期中）」を添えて中立色にする（削減でも success 色にしない）', async () => {
      getTargetProgress.mockResolvedValue(progressData(450, 900));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      expect(textOf(container)).toContain('2024年度比 ▲55.0%（期中）');
      expect(colorOfComparison(container)).toBe('var(--color-text-muted)');
      unmount();
    });

    it('期中に実績が基準年度を超えていても中立色のままにする', async () => {
      getTargetProgress.mockResolvedValue(progressData(1050, 900));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      expect(textOf(container)).toContain('2024年度比 +5.0%（期中）');
      expect(colorOfComparison(container)).toBe('var(--color-text-muted)');
      unmount();
    });

    // 基準年度より前の年度は削減パスの対象外なので、増減率は出しつつ評価色は付けない。
    it('基準年度より前の年度は増減率を中立色で出す', async () => {
      getTargetProgress.mockResolvedValue(
        progressData(1050, null, {
          target: {
            baseFiscalYear: FY2026,
            baseYearEmissions: 1000,
            baseYearSource: 'aggregate',
            targetYears: [],
            targetsByYear: {},
            currentReductionPercent: null,
          },
        }),
      );
      const { container, unmount } = renderCard(FY2025);
      await flush();

      const text = textOf(container);
      expect(text).toContain('2026年度比 +5.0%');
      expect(text).not.toContain('（期中）');
      expect(colorOfComparison(container)).toBe('var(--color-text-muted)');
      unmount();
    });

    it('表示年度が基準年度そのものなら増減率ではなく「基準年度」であることを示す', async () => {
      getTargetProgress.mockResolvedValue(
        progressData(1000, null, {
          target: {
            baseFiscalYear: FY2024,
            baseYearEmissions: 1000,
            baseYearSource: 'aggregate',
            targetYears: [{ targetYear: 2026, reductionPercent: 10 }],
            targetsByYear: { 2026: 900 },
            currentReductionPercent: null,
          },
        }),
      );
      const { container, unmount } = renderCard(FY2024);
      await flush();

      const text = textOf(container);
      expect(text).toContain('基準年度（比較の分母）');
      expect(text).not.toContain('2024年度比 ±0.0%');
      unmount();
    });

    it('基準年度の実績が 0 なら増減率を出さない', async () => {
      getTargetProgress.mockResolvedValue(
        progressData(100, 0, {
          target: {
            baseFiscalYear: FY2024,
            baseYearEmissions: 0,
            baseYearSource: 'aggregate',
            targetYears: [{ targetYear: 2026, reductionPercent: 10 }],
            targetsByYear: { 2026: 0 },
            currentReductionPercent: 10,
          },
        }),
      );
      const { container, unmount } = renderCard(FY2026);
      await flush();

      const text = textOf(container);
      expect(text).toContain('2024年度比 —');
      expect(text).not.toMatch(/2024年度比 [▲+±]/);
      unmount();
    });

    it('目標が未設定なら基準年度比は出さない', async () => {
      getTargetProgress.mockResolvedValue(progressData(100, null, { target: null }));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      expect(textOf(container)).not.toContain('年度比');
      unmount();
    });
  });

  // 基準年度の実績は表示のたびに引き直すため、まだ終了していない年度を基準にすると
  // 設定を変えないまま各年度の目標排出量が動く。選べなくはしないので、動くことを明示する。
  describe('終了していない基準年度の注意書き', () => {
    it('モーダルで期中の年度を選ぶと注意書きを出し、実績プレビューに「（期中の累計）」を添える', async () => {
      getTargetProgress.mockResolvedValue(progressData(180, 200));
      getFiscalYearTotalEmissions.mockResolvedValue({ total: 1000, source: 'aggregate' });
      const { container, unmount } = renderCard(FY2026);
      await flush();

      click(editButtonOf(container));
      await flush();
      // 既定の基準年度は保存済みの FY2024（終了済み）なので注意書きは出ない
      expect(dialogTextOf(container)).not.toContain('まだ終了していないため');
      expect(dialogTextOf(container)).toContain('基準年度の実績 1,000 t-CO2e');
      expect(dialogTextOf(container)).not.toContain('（期中の累計）');

      setSelectValue(baseYearSelectOf(container), FY2026.id);
      await flush();

      expect(dialogTextOf(container)).toContain(buildUnendedBaseYearNotice('2026年度'));
      expect(dialogTextOf(container)).toContain('基準年度の実績 1,000 t-CO2e（期中の累計）');
      unmount();
    });

    it('保存済みの基準年度が期中なら、カードの基準年度排出量にも注意書きを出す', async () => {
      getTargetProgress.mockResolvedValue(
        progressData(80, null, {
          target: {
            baseFiscalYear: FY2026,
            baseYearEmissions: 100,
            baseYearSource: 'aggregate',
            targetYears: [{ targetYear: 2027, reductionPercent: 10 }],
            targetsByYear: { 2027: 90 },
            currentReductionPercent: null,
          },
        }),
      );
      const { container, unmount } = renderCard(FY2026);
      await flush();

      expect(textOf(container)).toContain(buildUnendedBaseYearNotice('2026年度'));
      unmount();
    });

    it('保存済みの基準年度が終了済みならカードに注意書きを出さない', async () => {
      getTargetProgress.mockResolvedValue(progressData(180, 200));
      const { container, unmount } = renderCard(FY2026);
      await flush();

      expect(textOf(container)).toContain('2024年度の実績');
      expect(textOf(container)).not.toContain('まだ終了していないため');
      unmount();
    });
  });
});
