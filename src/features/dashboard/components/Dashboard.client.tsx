'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { PageHeading } from '@/components/layout/PageHeading';
import { RefreshingIndicator } from '@/components/ui/RefreshingIndicator';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import { isFiscalYearEnded } from '@/lib/fiscal-year/fiscalYearPeriod';
import { ArrowUpRight, X } from 'lucide-react';
import { Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, ComposedChart } from 'recharts';
import {
  getDashboardData,
  getDashboardLocationOptions,
  getLocationDashboardData,
  getYearlyEmissions,
  type DashboardData,
  type DashboardLocationOption,
  type DashboardSummaryItem,
  type DashboardYearlyPoint,
  type LocationDashboardData,
} from '../services/dashboardService';
import { LocationFilter } from './LocationFilter.client';
import {
  ReductionTargetCard,
  type ReductionTargetSummary,
} from '@/features/targets/components/ReductionTargetCard.client';
import { KpiCard } from './KpiCard';
import { TopLocationsTable } from './TopLocationsTable.client';

// KPI カードのラベル左に付く系列ドット（デザイン正の配色）。
const SCOPE_DOT: Record<DashboardSummaryItem['title'], string> = {
  総排出量: 'var(--color-primary)',
  'Scope 1': 'var(--color-scope-1)',
  'Scope 2': 'var(--color-scope-2)',
  'Scope 3': 'var(--color-scope-3)',
};

// Scope 3 内訳バーの配色。濃→淡のグリーン系＋テラコッタ（デザイン正）。
const SCOPE3_BAR_COLORS = [
  'var(--color-primary)',
  'var(--color-scope-1)',
  'var(--color-chart-green-subtle)',
  'var(--color-scope-2)',
  'var(--color-scope-3)',
];
const SCOPE3_REST_COLOR = 'var(--color-chart-gray-light)';

/** 排出量推移グラフの粒度。 */
type ChartMode = 'month' | 'year';

// 月別・年度別のどちらの系列も同じ ComposedChart に渡すための共通形。
// 拠点絞り込み中の月別点は scope3 を持たず、年度別点は前年度ラインを持たない。
type ChartPoint = {
  name: string;
  scope1: number;
  scope2: number;
  scope3?: number;
  previousYearTotal?: number | null;
  /** 年度別表示の目標ライン（その年度の年間目標排出量）。削減率未設定の年度は null */
  target?: number | null;
};

// 年度別表示で1年度あたりに確保する最小幅（px）。年度が増えるとこの幅で横に伸び、
// カード幅を超えたぶんは横スクロールで見る。
const YEAR_CHART_COLUMN_WIDTH = 96;

const formatNumber = (value: number) =>
  new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 3,
  }).format(value);

// カテゴリ番号は別バッジで見せるため、ラベル先頭の「カテゴリN: 」表記は落として重複を避ける。
// コロン無しのフォールバック名（例: 未知カテゴリの「カテゴリ5」）でも番号を除去できるようコロンは任意。
const stripCategoryPrefix = (name: string) => name.replace(/^カテゴリ\s*\d+\s*[:：]?\s*/, '');

export const Dashboard = () => {
  const { fiscalYear, fiscalYearId, fiscalYears, isLoading: isFiscalYearLoading } = useFiscalYear();
  const { refreshToken } = useAppRefresh();
  // 年度が1件も無い（初期セットアップ直後・最後の年度を削除した後）。この状態では
  // fiscalYear が永遠に空文字のままで下の取得 effect が走らず、「読み込んでいます...」から
  // 抜けられないため、Context のロード完了後に判定して空状態の案内へ切り替える。
  const hasNoFiscalYear = !isFiscalYearLoading && fiscalYears.length === 0;
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // 拠点絞り込み（null = 全拠点）。
  const [locationOptions, setLocationOptions] = useState<DashboardLocationOption[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationData, setLocationData] = useState<LocationDashboardData | null>(null);
  const [isLocationLoading, setIsLocationLoading] = useState(false);
  const [locationErrorMessage, setLocationErrorMessage] = useState('');
  // 選択拠点が一覧から消えた（削除された）ときの自動リセット通知。次の選択操作でクリアする。
  const [locationNotice, setLocationNotice] = useState('');

  // 排出量推移グラフの粒度。'month' = 選択年度の月別、'year' = 登録済み全年度の年度別。
  const [chartMode, setChartMode] = useState<ChartMode>('month');
  const [yearlyData, setYearlyData] = useState<DashboardYearlyPoint[]>([]);
  const [isYearlyLoading, setIsYearlyLoading] = useState(false);
  const [yearlyErrorMessage, setYearlyErrorMessage] = useState('');

  useEffect(() => {
    // FiscalYearContext のロード完了前は fiscalYear が空文字。このまま取得すると
    // 不正な年度クエリでエラー表示になるため、実際の年度が入るまで待つ。
    if (fiscalYear === '') return;

    let isMounted = true;

    const loadDashboardData = async () => {
      setIsLoading(true);
      setErrorMessage('');
      // 年度切替時に表示中データを null クリアしない。null にすると KPI・チャート・Scope3・
      // 上位拠点がまるごと空表示になり画面が一瞬白くなるため、前の年度の数値を保持したまま
      // 取得し、新データ到着時に数値だけ差し替える（stale-while-revalidate）。

      try {
        const data = await getDashboardData(fiscalYear, fiscalYearId);
        if (isMounted) {
          setDashboardData(data);
        }
      } catch (error) {
        if (isMounted) {
          setDashboardData(null);
          setErrorMessage(error instanceof Error ? error.message : 'ダッシュボードデータの取得に失敗しました');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadDashboardData();

    return () => {
      isMounted = false;
    };
  }, [fiscalYear, fiscalYearId, refreshToken]);

  // 拠点絞り込みドロップダウンの選択肢は初回のみ取得する。
  useEffect(() => {
    let isMounted = true;

    getDashboardLocationOptions()
      .then(options => {
        if (isMounted) setLocationOptions(options);
      })
      .catch(() => {
        // 選択肢が取れなくてもダッシュボード本体（全拠点表示）は成立するため、
        // エラーにはせずチップを「全拠点」のみで表示する。
      });

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  // 拠点の選択/解除。解除時のクリアはイベントハンドラで行う（effect内の直接setStateを避ける）。
  const handleSelectLocation = (locationId: string | null) => {
    setSelectedLocationId(locationId);
    setLocationNotice('');
    if (!locationId) {
      setLocationData(null);
      setLocationErrorMessage('');
      setIsLocationLoading(false);
    }
  };

  // ポップオーバーを開くたびに拠点一覧を取り直す（他ユーザーの拠点追加/削除を反映）。
  // 取得に失敗した場合は前回のリストのまま使い続ける。
  const handleRefreshLocationOptions = async () => {
    try {
      const options = await getDashboardLocationOptions();
      setLocationOptions(options);
      // 選択中の拠点が一覧から消えていたら全拠点表示へ自動リセットし、注記で知らせる。
      if (selectedLocationId && !options.some(option => option.id === selectedLocationId)) {
        handleSelectLocation(null);
        setLocationNotice('選択していた拠点が拠点一覧に見つからなくなったため、全拠点表示に戻しました。');
      }
    } catch {
      // 前回リストで継続（ダッシュボード本体には影響しない）。
    }
  };

  // 拠点選択時は当該拠点の Scope 1/2 集計を取得する。
  useEffect(() => {
    if (!selectedLocationId) return;

    let isMounted = true;

    const loadLocationData = async () => {
      setIsLocationLoading(true);
      setLocationErrorMessage('');
      // 拠点切替時も直前の拠点データを保持し、空表示（白い瞬間）を避ける。
      // 新データ到着時に数値だけ差し替える（stale-while-revalidate）。

      try {
        const data = await getLocationDashboardData(fiscalYear, selectedLocationId, fiscalYearId);
        if (isMounted) {
          setLocationData(data);
        }
      } catch (error) {
        if (isMounted) {
          setLocationData(null);
          setLocationErrorMessage(
            error instanceof Error ? error.message : '拠点別データの取得に失敗しました',
          );
        }
      } finally {
        if (isMounted) {
          setIsLocationLoading(false);
        }
      }
    };

    void loadLocationData();

    return () => {
      isMounted = false;
    };
  }, [fiscalYear, fiscalYearId, selectedLocationId, refreshToken]);

  // 年度別表示に切り替えたときだけ全年度の集計を取りに行く（月別表示のままなら1クエリも増やさない）。
  useEffect(() => {
    if (chartMode !== 'year' || fiscalYears.length === 0) return;

    let isMounted = true;

    const loadYearlyData = async () => {
      setIsYearlyLoading(true);
      setYearlyErrorMessage('');
      // 拠点・年度一覧の切替時も直前の系列を保持し、空表示（白い瞬間）を避ける。

      try {
        const points = await getYearlyEmissions(fiscalYears, selectedLocationId);
        if (isMounted) {
          setYearlyData(points);
        }
      } catch (error) {
        if (isMounted) {
          setYearlyData([]);
          setYearlyErrorMessage(
            error instanceof Error ? error.message : '年度別排出量の取得に失敗しました',
          );
        }
      } finally {
        if (isMounted) {
          setIsYearlyLoading(false);
        }
      }
    };

    void loadYearlyData();

    return () => {
      isMounted = false;
    };
  }, [chartMode, fiscalYears, selectedLocationId, refreshToken]);

  const summaryData = useMemo(
    () =>
      (dashboardData?.summary ?? []).map(item => ({
        ...item,
        dotColor: SCOPE_DOT[item.title],
        formattedValue: formatNumber(item.value),
      })),
    [dashboardData],
  );

  const totalSummary = summaryData.find(item => item.title === '総排出量') ?? null;
  const scopeSummary = summaryData.filter(item => item.title !== '総排出量');
  const orgScope3Summary = summaryData.find(item => item.title === 'Scope 3') ?? null;

  const isFiltered = selectedLocationId !== null;
  const selectedLocationName =
    locationOptions.find(option => option.id === selectedLocationId)?.name ?? '選択中の拠点';
  // KPI カードの表示モデル（総排出量 + Scope 1/2/3）。
  // 全拠点: dashboard_aggregates の組織集計。拠点選択: 当該拠点の Scope 1/2（emission_results 由来）。
  // Scope 3 は組織・年度単位でしか持てないため、拠点選択中は組織全体の値を注記つきで見せる。
  const monthlyData = useMemo(() => dashboardData?.monthlyData ?? [], [dashboardData]);
  const topLocationDetails = dashboardData?.topLocationDetails ?? [];
  // 月次 Scope 3 は活動量由来（emission_results）のみ。年次集計だけの組織では月別内訳が無く
  // バーが全月0になるため、その場合だけ注記を出して「0=データ無し」を明示する。
  // Scope 3 のデータ自体が無い組織（年間合計 0）では「年次集計は在る」と誤読させるため出さない。
  const hasMonthlyScope3 = monthlyData.some(point => point.scope3 > 0);

  // 拠点選択中の月別推移は Scope 1/2 のみ（Scope 3 は組織・年度単位のため表示しない）。
  const monthlyChartData = useMemo(
    () => (isFiltered ? locationData?.monthlyData ?? [] : monthlyData),
    [isFiltered, locationData, monthlyData],
  );
  const isYearMode = chartMode === 'year';
  const showScope3Series = !isFiltered;
  // 昨年度比較ラインは月別表示のみ（年度別表示では各バーがそのまま年度比較になる）。
  // 前年度データがある場合だけ表示する（凡例にも出さない）。
  // 拠点絞り込み中も前年同拠点のデータで比較する（KPI の前年比サマリーと同じ集計系統）。
  const showPreviousYearSeries =
    !isYearMode && monthlyChartData.some(point => point.previousYearTotal !== null);

  // スパークライン用の月別系列。拠点絞り込み中の点は Scope 3 を持たないため任意扱いにする。
  const sparkSeries = useMemo(() => {
    const points = monthlyChartData as { scope1: number; scope2: number; scope3?: number }[];
    return {
      total: points.map(point => point.scope1 + point.scope2 + (point.scope3 ?? 0)),
      scope1: points.map(point => point.scope1),
      scope2: points.map(point => point.scope2),
      // Scope 3 は拠点別に持てないため、絞り込み中も組織全体の月別系列を使う。
      scope3: monthlyData.map(point => point.scope3),
    };
  }, [monthlyChartData, monthlyData]);

  const previousFiscalYearLabel = `${Number(fiscalYear) - 1}年度`;
  const comparisonLabel = `vs ${previousFiscalYearLabel}`;
  const selectedFiscalYear = fiscalYears.find(year => year.id === fiscalYearId) ?? null;
  const fiscalYearLabel = selectedFiscalYear?.label ?? `${fiscalYear}年度`;

  // 削減目標カードが読む年度期間。参照が毎レンダー変わると取得が繰り返されるため、
  // 期間の日付が変わったときだけ新しいオブジェクトにする。
  const fiscalYearStartDate = selectedFiscalYear?.startDate ?? null;
  const fiscalYearEndDate = selectedFiscalYear?.endDate ?? null;
  const targetPeriod = useMemo(
    () =>
      fiscalYearStartDate && fiscalYearEndDate
        ? { startDate: fiscalYearStartDate, endDate: fiscalYearEndDate }
        : null,
    [fiscalYearStartDate, fiscalYearEndDate],
  );

  // 前年比（KPI カード・上位拠点テーブル）の評価色は年度終了後に限る。分子＝表示年度の期中累計・
  // 分母＝前年度の通年実績の比較のため、期中は増減率を出しても良し悪しを断定できない。
  // 年度行の期間が取れないときは断定しない側（期中扱い）に倒す。
  const fiscalYearEnded = targetPeriod !== null && isFiscalYearEnded(targetPeriod);

  // グラフに引く目標ライン。削減目標カードが読み込み・保存のたびに渡してくる。
  const [targetSummary, setTargetSummary] = useState<ReductionTargetSummary>({
    annualTarget: null,
    targetsByYear: {},
  });
  const handleTargetChange = useCallback(
    (summary: ReductionTargetSummary) => setTargetSummary(summary),
    [],
  );
  // 年度別表示の各点には、その年度の目標排出量（削減率が入っている年度のみ）を添える。
  const chartData: ChartPoint[] = useMemo(
    () =>
      isYearMode
        ? yearlyData.map(point => ({
            ...point,
            target: targetSummary.targetsByYear[point.year] ?? null,
          }))
        : monthlyChartData,
    [isYearMode, yearlyData, monthlyChartData, targetSummary],
  );

  // 拠点で絞り込むと分子（拠点別 Scope 1・2）と目標（組織全体）の範囲が食い違うため線は出さない。
  // 月別表示は選択年度の年間目標を月平均に均した水平線を引く。
  const monthlyTargetLine =
    !isFiltered && !isYearMode && targetSummary.annualTarget !== null
      ? targetSummary.annualTarget / 12
      : null;
  // 年度別表示は年度ごとに目標が違うため、水平線ではなく年度をまたぐ目標ラインとして引く。
  const showYearlyTargetLine = !isFiltered && chartData.some(point => point.target != null);

  const kpiCards = useMemo(() => {
    const diffOf = (percent: number | null) => ({ percent, comparisonLabel });

    if (!isFiltered) {
      if (!totalSummary) return null;
      return [
        {
          id: 'total',
          label: '総排出量',
          formattedValue: totalSummary.formattedValue,
          diff: diffOf(totalSummary.diffPercent),
          series: sparkSeries.total,
        },
        ...scopeSummary.map(item => ({
          id: item.title.replace(/\s+/g, '').toLowerCase(),
          label: item.title,
          dotColor: item.dotColor,
          formattedValue: item.formattedValue,
          diff: diffOf(item.diffPercent),
          series:
            item.title === 'Scope 1'
              ? sparkSeries.scope1
              : item.title === 'Scope 2'
                ? sparkSeries.scope2
                : sparkSeries.scope3,
        })),
      ];
    }

    if (!locationData) return null;
    return [
      {
        id: 'total',
        label: `総排出量（${selectedLocationName}）`,
        formattedValue: formatNumber(locationData.combinedTotal),
        diff: diffOf(locationData.totalDiffPercent),
        series: sparkSeries.total,
      },
      {
        id: 'scope1',
        label: 'Scope 1',
        dotColor: SCOPE_DOT['Scope 1'],
        formattedValue: formatNumber(locationData.scope1Total),
        diff: diffOf(locationData.scope1DiffPercent),
        series: sparkSeries.scope1,
      },
      {
        id: 'scope2',
        label: 'Scope 2',
        dotColor: SCOPE_DOT['Scope 2'],
        formattedValue: formatNumber(locationData.scope2Total),
        diff: diffOf(locationData.scope2DiffPercent),
        series: sparkSeries.scope2,
      },
      {
        id: 'scope3',
        label: 'Scope 3（組織全体）',
        dotColor: SCOPE_DOT['Scope 3'],
        formattedValue: orgScope3Summary ? orgScope3Summary.formattedValue : '—',
        diff: null,
        note: { pill: '拠点別内訳なし', description: '組織・年度単位' },
        series: sparkSeries.scope3,
      },
    ];
  }, [
    isFiltered,
    totalSummary,
    scopeSummary,
    locationData,
    orgScope3Summary,
    selectedLocationName,
    sparkSeries,
    comparisonLabel,
  ]);

  // 見出しの「計」は Scope 3 サマリーカードと同じ値を使い、KPI カードと数字が食い違わないようにする。
  // サマリーの Scope 3 は内訳バー（scope3PieData）と同じカテゴリ別採用値 RPC の合計から導いている
  // （buildDashboardSummary 参照）ため、dashboard_aggregates の更新が失敗していても
  // バーの合計とこの「計」は一致する。summary は集計行が無くても常に4項目を持つので、
  // 内訳から再計算するフォールバックは不要（データ未取得時のみ 0）。
  const scope3Total = orgScope3Summary?.value ?? 0;

  // 内訳リストは排出量の多い順に上位5カテゴリを個別表示し、残りは「その他」へ集約する
  // （どのカテゴリが登録されていても崩れないようデータ駆動で束ねる）。
  const scope3Breakdown = useMemo(() => {
    const sorted = [...(dashboardData?.scope3PieData ?? [])].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5);
    const maxValue = top[0]?.value ?? 0;

    const rows = top.map((item, index) => ({
      key: `cat-${item.categoryId}`,
      badge: String(item.categoryId).padStart(2, '0'),
      // 番号のみのフォールバック名（「カテゴリ5」等）は除去後に空になるため、名称未設定として表示する。
      label: stripCategoryPrefix(item.name) || '名称未設定のカテゴリ',
      value: item.value,
      percent: item.percent,
      barWidth: maxValue > 0 ? (item.value / maxValue) * 100 : 0,
      color: SCOPE3_BAR_COLORS[index % SCOPE3_BAR_COLORS.length],
      muted: false,
    }));

    if (rest.length > 0) {
      const restValue = rest.reduce((sum, item) => sum + item.value, 0);
      const restPercent = rest.reduce((sum, item) => sum + item.percent, 0);
      rows.push({
        key: 'cat-rest',
        badge: '—',
        label: `その他（${rest.length} カテゴリ）`,
        value: restValue,
        percent: restPercent,
        barWidth: maxValue > 0 ? (restValue / maxValue) * 100 : 0,
        color: SCOPE3_REST_COLOR,
        muted: true,
      });
    }

    return rows;
  }, [dashboardData]);

  const isBandLoading = isFiltered ? isLocationLoading || isLoading : isLoading;
  // グラフだけは年度別取得中も薄く見せる（KPI カード等は年度別取得の影響を受けない）。
  const isChartLoading = isYearMode ? isYearlyLoading : isBandLoading;

  // 年度未登録の空状態。子カード（削減目標・上位拠点・月別グラフ）は年度が無いと
  // 自身の「読み込み中...」から抜けられないため、ここで描画自体を止めて案内だけ出す。
  if (hasNoFiscalYear) {
    return (
      <div className="page-content gt-scroll relative">
        <PageHeading title="ダッシュボード" description="全社の排出量サマリーと削減進捗" />
        <div className="gt-card" style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          <p style={{ margin: 0 }}>算定年度が登録されていません。企業設定から年度を追加してください。</p>
          <Link href="/settings/company" className="gt-btn" style={{ marginTop: '12px' }}>
            企業設定へ
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content gt-scroll relative">
      <PageHeading
        title="ダッシュボード"
        description="全社の排出量サマリーと削減進捗"
        actions={
          <LocationFilter
            options={locationOptions}
            selectedId={selectedLocationId}
            onSelect={handleSelectLocation}
            onOpen={() => void handleRefreshLocationOptions()}
          />
        }
      />

      {errorMessage && (
        <div
          className="rounded-md px-4 py-3 text-sm"
          style={{
            marginBottom: '14px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-bg-card)',
            color: 'var(--color-danger)',
          }}
        >
          {errorMessage}
        </div>
      )}
      {locationErrorMessage && (
        <div
          className="rounded-md px-4 py-3 text-sm"
          style={{
            marginBottom: '14px',
            border: '1px solid var(--color-danger)',
            backgroundColor: 'var(--color-bg-card)',
            color: 'var(--color-danger)',
          }}
        >
          {locationErrorMessage}
        </div>
      )}
      {locationNotice && (
        <div
          className="rounded-md px-4 py-3 text-sm"
          style={{
            marginBottom: '14px',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-bg-card)',
            color: 'var(--color-text-muted)',
          }}
        >
          {locationNotice}
        </div>
      )}

      {/* ===== 絞り込み中チップ ===== */}
      {isFiltered && (
        <div className="flex flex-wrap items-center" style={{ gap: '11px', margin: '-4px 0 14px' }}>
          <span style={{ fontSize: '12px', color: 'var(--color-text-subtle)' }}>絞り込み中</span>
          <span
            className="inline-flex items-center gt-pill gt-pill-accent"
            style={{ height: '26px', padding: '0 6px 0 12px' }}
          >
            {selectedLocationName}
            <button
              type="button"
              onClick={() => handleSelectLocation(null)}
              aria-label="拠点の絞り込みを解除"
              className="rounded-full flex items-center justify-center hover:bg-bg-subtle"
              style={{ width: '18px', height: '18px', color: 'inherit' }}
            >
              <X size={10} strokeWidth={3} />
            </button>
          </span>
          <span style={{ fontSize: '12px', color: 'var(--color-text-subtle)' }}>
            Scope 1・2 のみ拠点別に集計しています。Scope 3 は組織・年度単位のため組織全体の値です。
          </span>
        </div>
      )}

      {/* 年度・拠点の切替後、新データ取得が完了するまでは前回の数値を保持して表示するため
          （stale-while-revalidate、白画面回避）、その間は「更新中」を明示して、切替後のラベルと
          まだ更新前の数値が並んだ状態を確定値と誤認させないようにする。 */}
      <RefreshingIndicator show={isBandLoading && Boolean(kpiCards)} top="22px" right="26px" />

      {/* ===== KPI カード ===== */}
      {kpiCards ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: '14px',
          }}
        >
          {kpiCards.map(card => (
            <KpiCard
              key={card.id}
              id={card.id}
              label={card.label}
              dotColor={card.dotColor}
              formattedValue={card.formattedValue}
              diff={card.diff}
              note={card.note}
              series={card.series}
              fiscalYearEnded={fiscalYearEnded}
              isStale={isBandLoading}
            />
          ))}
        </div>
      ) : (
        <div className="gt-card" style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
          {isBandLoading ? (
            <LoadingIndicator label="ダッシュボードデータを読み込んでいます..." />
          ) : (
            '表示できる排出量データがありません。'
          )}
        </div>
      )}

      {/* ===== 削減目標 ===== */}
      <div style={{ marginTop: '14px' }}>
        <ReductionTargetCard
          fiscalYearId={fiscalYearId}
          fiscalYearLabel={fiscalYearLabel}
          period={targetPeriod}
          fiscalYears={fiscalYears}
          refreshToken={refreshToken}
          onTargetChange={handleTargetChange}
        />
      </div>

      {/* ===== 月別排出量推移 + Scope 3 内訳 ===== */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
          gap: '14px',
          marginTop: '14px',
        }}
      >
        <section className="gt-card gt-col-8">
          <div className="gt-card-head">
            <div>
              <h2 className="gt-card-title">{isYearMode ? '年度別排出量推移' : '月別排出量推移'}</h2>
              <p className="gt-card-sub">
                {isYearMode ? '登録済みの全年度' : fiscalYearLabel}・
                {isFiltered ? selectedLocationName : '全拠点'}
              </p>
            </div>
            <div className="flex flex-wrap items-center" style={{ gap: '10px', fontSize: '12.5px', color: 'var(--color-text-muted)' }}>
              {/* 月別（選択年度の12ヶ月）と年度別（登録済み全年度）の切替。 */}
              <div
                className="inline-flex items-center"
                style={{
                  padding: '3px',
                  gap: '3px',
                  borderRadius: '9px',
                  border: '1px solid var(--color-border-strong)',
                  backgroundColor: 'var(--color-bg-subtle)',
                }}
              >
                {([
                  { mode: 'month' as ChartMode, label: '月別' },
                  { mode: 'year' as ChartMode, label: '年度別' },
                ]).map(option => {
                  const isActive = chartMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => setChartMode(option.mode)}
                      aria-pressed={isActive}
                      style={{
                        height: '26px',
                        padding: '0 12px',
                        borderRadius: '7px',
                        fontSize: '12px',
                        fontWeight: isActive ? 600 : 500,
                        backgroundColor: isActive ? 'var(--color-bg-card)' : 'transparent',
                        boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                        color: isActive ? 'var(--color-text-heading)' : 'var(--color-text-muted)',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <span className="inline-flex items-center" style={{ gap: '6px' }}>
                <span className="rounded-full" style={{ width: '8px', height: '8px', backgroundColor: 'var(--color-scope-1)' }} />
                Scope 1
              </span>
              <span className="inline-flex items-center" style={{ gap: '6px' }}>
                <span className="rounded-full" style={{ width: '8px', height: '8px', backgroundColor: 'var(--color-scope-2)' }} />
                Scope 2
              </span>
              {showScope3Series && (
                <span className="inline-flex items-center" style={{ gap: '6px' }}>
                  <span className="rounded-full" style={{ width: '8px', height: '8px', backgroundColor: 'var(--color-scope-3)' }} />
                  Scope 3
                </span>
              )}
              {showPreviousYearSeries && (
                <span className="inline-flex items-center" style={{ gap: '6px' }}>
                  <span style={{ width: '15px', height: 0, borderTop: '1.6px solid var(--color-chart-indigo)' }} />
                  {previousFiscalYearLabel}
                </span>
              )}
              {(isYearMode ? showYearlyTargetLine : monthlyTargetLine !== null) && (
                <span className="inline-flex items-center" style={{ gap: '6px' }}>
                  <span style={{ width: '15px', height: 0, borderTop: '1.6px dashed var(--color-chart-target)' }} />
                  {isYearMode ? '年度目標' : '年間目標（月平均）'}
                </span>
              )}
            </div>
          </div>

          {/* 年度別表示は年度が増えるほど横に伸ばし、カード幅を超えたぶんは横スクロールで見せる。 */}
          <div
            className={clsx('w-full', isYearMode && 'gt-scroll')}
            style={{
              marginTop: '16px',
              overflowX: isYearMode ? 'auto' : undefined,
              opacity: isChartLoading ? 0.45 : 1,
              transition: 'opacity .25s',
            }}
          >
            <div
              style={{
                height: '300px',
                minWidth: isYearMode ? `${chartData.length * YEAR_CHART_COLUMN_WIDTH}px` : undefined,
              }}
            >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--color-text-subtle)' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--color-text-subtle)' }} width={52} />
                <Tooltip
                  cursor={{ fill: 'var(--color-bg-subtle)' }}
                  // 前年度ラインは未記録の月を null で持つ。既定の filterNull だと
                  // ツールチップから行ごと消えて「0」なのか「未記録」なのか読めないため、
                  // 月別表示では null を落とさず「データなし」と明示する。
                  filterNull={!showPreviousYearSeries}
                  formatter={value => (value === null || value === undefined ? 'データなし' : value)}
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: 'var(--shadow-md)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="scope1" stackId="a" fill="var(--color-scope-1)" maxBarSize={26} name="Scope 1" />
                {/* 拠点選択中は Scope 2 が積み上げの最上段になるため、角丸を Scope 2 側に付ける。 */}
                <Bar
                  dataKey="scope2"
                  stackId="a"
                  fill="var(--color-scope-2)"
                  maxBarSize={26}
                  name="Scope 2"
                  radius={showScope3Series ? undefined : [4, 4, 0, 0]}
                />
                {showScope3Series && (
                  <Bar dataKey="scope3" stackId="a" fill="var(--color-scope-3)" radius={[4, 4, 0, 0]} maxBarSize={26} name="Scope 3" />
                )}
                {monthlyTargetLine !== null && (
                  <ReferenceLine
                    y={monthlyTargetLine}
                    stroke="var(--color-chart-target)"
                    strokeDasharray="4 4"
                    strokeWidth={1.6}
                    ifOverflow="extendDomain"
                  />
                )}
                {showYearlyTargetLine && (
                  <Line
                    type="linear"
                    dataKey="target"
                    stroke="var(--color-chart-target)"
                    strokeDasharray="4 4"
                    strokeWidth={1.6}
                    dot={{ r: 3 }}
                    activeDot={{ r: 4 }}
                    name="年度目標"
                    connectNulls
                  />
                )}
                {showPreviousYearSeries && (
                  <Line
                    type="monotone"
                    dataKey="previousYearTotal"
                    stroke="var(--color-chart-indigo)"
                    strokeWidth={1.6}
                    dot={false}
                    activeDot={{ r: 4 }}
                    name={previousFiscalYearLabel}
                    connectNulls={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          </div>
          {yearlyErrorMessage && (
            <p style={{ fontSize: '12px', color: 'var(--color-danger)', marginTop: '8px' }}>
              {yearlyErrorMessage}
            </p>
          )}
          {isFiltered ? (
            <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
              ※ 拠点選択中は Scope 1・2 のみの積み上げです。Scope 3 は組織・年度単位のため表示されません。
              {showPreviousYearSeries && `${previousFiscalYearLabel}ラインも同拠点の Scope 1・2 合計です。`}
            </p>
          ) : isYearMode ? (
            !isYearlyLoading &&
            yearlyData.length > 0 && (
              <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                ※ 年度別は算定確定値（dashboard_aggregates）です。まだ算定していない年度は 0 と表示されます。
              </p>
            )
          ) : (
            !isLoading && scope3Total > 0 && !hasMonthlyScope3 && (
              <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                ※ Scope 3 は年次で集計しているため、月別グラフには含まれていません。
              </p>
            )
          )}
        </section>

        <section className="gt-card gt-col-4 flex flex-col">
          <div className="gt-card-head">
            <div>
              <h2 className="gt-card-title">Scope 3 内訳</h2>
              <p className="gt-card-sub">
                計 {formatNumber(scope3Total)} t-CO2e・上位 5 カテゴリ{isFiltered && '（組織全体）'}
              </p>
            </div>
          </div>

          <div
            className="flex flex-col flex-1"
            style={{ gap: '14px', marginTop: '18px', opacity: isBandLoading ? 0.45 : 1, transition: 'opacity .25s' }}
          >
            {scope3Breakdown.map(row => (
              <div key={row.key}>
                <div className="flex items-baseline" style={{ gap: '10px', fontSize: '13.5px', marginBottom: '7px' }}>
                  <span style={{ flex: 'none', width: '18px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-subtle)' }}>
                    {row.badge}
                  </span>
                  <span
                    className="truncate"
                    style={{ flex: 1, minWidth: 0, color: row.muted ? 'var(--color-text-muted)' : 'var(--color-text-body)' }}
                  >
                    {row.label}
                  </span>
                  <span style={{ flex: 'none', fontWeight: 600, color: row.muted ? 'var(--color-text-muted)' : 'var(--color-text-body)' }}>
                    {formatNumber(row.value)}
                  </span>
                  <span style={{ flex: 'none', width: '46px', textAlign: 'right', fontSize: '12px', color: 'var(--color-text-subtle)' }}>
                    {row.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="rounded-full" style={{ height: '8px', backgroundColor: 'var(--color-chart-track)', overflow: 'hidden' }}>
                  <div
                    className="rounded-full"
                    style={{
                      width: `${row.barWidth}%`,
                      height: '100%',
                      backgroundColor: row.color,
                      transition: 'width .5s cubic-bezier(.2,.7,.2,1)',
                    }}
                  />
                </div>
              </div>
            ))}
            {!isLoading && scope3Breakdown.length === 0 && (
              <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                Scope 3カテゴリ別データはまだ登録されていません。
              </div>
            )}
          </div>

          <Link
            href="/scope-analysis"
            className="flex items-center justify-between"
            style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--color-border)' }}
          >
            <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--color-text-heading)' }}>
              Scope 3 カテゴリをすべて見る
            </span>
            <ArrowUpRight size={14} strokeWidth={1.9} style={{ color: 'var(--color-text-muted)' }} />
          </Link>
        </section>
      </div>

      {/* ===== 排出量上位拠点 ===== */}
      {/* 拠点で絞り込み中は表示しない。このランキングは組織全体の Scope 1・2 集計で拠点絞り込みが
          効かないため、選択拠点の値（総排出量カード等）の横に他拠点の数値が並ぶと「絞り込みが
          効いていない」と誤読させる。全社ランキングは全拠点ビューでこそ意味を持つ情報。 */}
      {!isFiltered && (
        <div style={{ marginTop: '14px' }}>
          <TopLocationsTable
            rows={topLocationDetails}
            fiscalYearLabel={fiscalYearLabel}
            fiscalYearEnded={fiscalYearEnded}
            selectedLocationId={selectedLocationId}
            onSelectLocation={handleSelectLocation}
            isStale={isBandLoading}
            emptyMessage={
              isLoading ? '読み込み中...' : '拠点別の排出量データはまだ登録されていません。'
            }
          />
        </div>
      )}
    </div>
  );
};
