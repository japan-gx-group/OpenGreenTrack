'use client';

import { useEffect, useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { useAppRefresh } from '@/hooks/useAppRefresh';
import { Card } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { isCurrentFiscalYear } from '@/lib/fiscal-year/fiscalYearPeriod';
import {
  createReportGenerationLog,
  getReportBaseData,
  getReportEmissionResults,
  type ReportData,
  type ReportEmissionResult,
  type ReportFiscalYear,
  type ReportHistoryItem,
  type ReportLocation,
  type ReportTargetSummary,
  type ReportTypeId,
} from '../services/reportService';
import { buildReportDocument } from '../services/reportContent';
import { describeCalculationFreshness } from '../services/reportPreview';
import { POPUP_BLOCKED_MESSAGE, downloadReportCsv, openReportPrintView } from '../services/reportExport';
import { ORGANIZATION_WIDE_TARGET_LABEL, REPORT_TYPE_LABELS, usesLocationFilter } from '../types';
import {
  FileText,
  TrendingUp,
  MapPin,
  Download,
  Clock,
  Calendar,
  Loader2,
  FileSpreadsheet,
  Info,
  AlertCircle,
  Eye,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ReportType {
  id: ReportTypeId;
  title: string;
  description: string;
  icon: LucideIcon;
  badge: string;
  color: string;
  bg: string;
}

// タイトルは正本の REPORT_TYPE_LABELS を参照し、CSV・印刷ビューとの表記ズレを防ぐ。
const reportTypes: ReportType[] = [
  {
    id: 'annual_summary',
    title: REPORT_TYPE_LABELS.annual_summary,
    description: 'Scope 1, 2, 3 の排出量サマリ、拠点別の Scope 1・2 内訳、Scope 3 算定方法をまとめた年次報告書。',
    icon: FileText,
    badge: '推奨',
    color: 'var(--color-primary)',
    bg: 'var(--color-primary-light)',
  },
  {
    id: 'scope3_detail',
    title: REPORT_TYPE_LABELS.scope3_detail,
    description: 'カテゴリ1〜15の排出内訳、主要サプライヤーの排出量と一次データ率、カテゴリ別の算定方法をまとめた詳細分析報告書。',
    icon: TrendingUp,
    badge: '詳細分析',
    color: 'var(--color-scope-3)',
    bg: 'var(--color-scope-3-bg)',
  },
  {
    id: 'location_breakdown',
    title: REPORT_TYPE_LABELS.location_breakdown,
    description: '各拠点の Scope 1・2 排出量と、電気・ガスなどのエネルギー使用量をそれぞれ一覧にした報告書。',
    icon: MapPin,
    badge: '拠点比較',
    color: 'var(--color-scope-2)',
    bg: 'var(--color-scope-2-bg)',
  },
];

const formatEmissions = (value: number): string => `${value.toLocaleString('ja-JP', {
  maximumFractionDigits: 3,
})} t-CO2e`;

const formatDateTime = (value?: string): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

// 履歴から再生成できるか。拠点選択を使う種別は拠点条件の記録が必須だが、
// Scope 3 詳細は組織全体の集計のため種別と年度だけで再生成できる。
const canRedownload = (report: ReportHistoryItem): boolean => (
  !!report.reportType
  && !!report.fiscalYearId
  && (!usesLocationFilter(report.reportType) || report.locationIds.length > 0)
);

export const Reports = () => {
  const [selectedType, setSelectedType] = useState<ReportTypeId>('annual_summary');
  const { fiscalYearId, setFiscalYearId } = useFiscalYear();
  const { refreshToken } = useAppRefresh();
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf');
  const [fiscalYears, setFiscalYears] = useState<ReportFiscalYear[]>([]);
  const [locations, setLocations] = useState<ReportLocation[]>([]);
  const [summaries, setSummaries] = useState<ReportTargetSummary[]>([]);
  const [emissionResults, setEmissionResults] = useState<ReportEmissionResult[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [redownloadingId, setRedownloadingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [history, setHistory] = useState<ReportHistoryItem[]>([]);

  // 年度に依存しないデータ（会計年度・拠点・年度別サマリ・出力履歴）は初回に1度だけ読む。
  useEffect(() => {
    let isMounted = true;

    const loadBaseData = async () => {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const data = await getReportBaseData();
        if (!isMounted) {
          return;
        }

        setFiscalYears(data.fiscalYears);
        setLocations(data.locations);
        setSummaries(data.summaries);
        setHistory(data.histories);
        setSelectedLocations(data.locations.map(location => location.id));
      } catch (error) {
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : 'レポート対象データの取得に失敗しました');
          setFiscalYears([]);
          setLocations([]);
          setSummaries([]);
          setEmissionResults([]);
          setHistory([]);
          setSelectedLocations([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadBaseData();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  // 拠点 × Scope の算定結果は選択年度分だけを読む（全年度を先読みすると
  // 転送量とページング往復が年度数に比例して増えるため）。年度切替のたびに読み直す。
  useEffect(() => {
    // 年度未確定のうちは取得しない。表示側は fiscalYearId で絞るため、
    // 前年度の行が残っていても選択年度の集計には混ざらない。
    if (!fiscalYearId) return;

    let isMounted = true;

    const loadEmissionResults = async () => {
      try {
        const rows = await getReportEmissionResults(fiscalYearId);
        if (isMounted) {
          setEmissionResults(rows);
        }
      } catch (error) {
        if (isMounted) {
          setEmissionResults([]);
          setErrorMessage(error instanceof Error ? error.message : '拠点別算定結果の取得に失敗しました');
        }
      }
    };

    void loadEmissionResults();

    return () => {
      isMounted = false;
    };
  }, [fiscalYearId, refreshToken]);

  useEffect(() => {
    if (isLoading || fiscalYears.length === 0) return;
    if (fiscalYearId && fiscalYears.some(year => year.id === fiscalYearId)) return;

    // 既定は最新年度（startDate 降順の先頭）。FiscalYearContext の既定年度と同じ方針にそろえる。
    // 「現在の年度」は DB のフラグではなく日付から導く（isCurrentFiscalYear のコメント参照）。
    setFiscalYearId(fiscalYears[0].id);
  }, [fiscalYearId, fiscalYears, isLoading, setFiscalYearId]);

  const selectedFiscalYear = fiscalYears.find(year => year.id === fiscalYearId);
  const selectedSummary = summaries.find(summary => summary.fiscalYearId === fiscalYearId);
  const reportTypeLabel = reportTypes.find(type => type.id === selectedType)?.title ?? 'レポート';
  // Scope 3 詳細は組織全体の集計で拠点選択を使わない。選択状態は種別を戻したときのために
  // 保持しつつ、生成・履歴・印刷ビューへは拠点を渡さない。
  const isLocationFilterUsed = usesLocationFilter(selectedType);
  const reportLocationIds = isLocationFilterUsed ? selectedLocations : [];
  // 拠点選択を使わない種別では、出力内容のプレビュー・履歴の合計も組織全体（全拠点）で集計する。
  const selectedEmissionResults = emissionResults.filter(result => (
    result.fiscalYearId === fiscalYearId
    && (!isLocationFilterUsed || selectedLocations.includes(result.locationId))
  ));
  const selectedScope1Total = selectedEmissionResults
    .filter(result => result.scope === 'scope1')
    .reduce((total, result) => total + result.emissions, 0);
  const selectedScope2Total = selectedEmissionResults
    .filter(result => result.scope === 'scope2')
    .reduce((total, result) => total + result.emissions, 0);
  const selectedScope3Total = selectedSummary?.scope3Total ?? 0;
  const selectedTotalEmissions = selectedScope1Total + selectedScope2Total + selectedScope3Total;
  // emissionResults は 拠点 × Scope で集約済みの行のため、算定済み件数は行数ではなく
  // 集約前の件数（recordCount）を合算する（DB 側で集計する）。
  // Scope 3 の「カテゴリ数」は単位が違うので足さず、プレビューでは別々に表示する。
  const selectedScope12RecordCount =
    selectedEmissionResults.reduce((total, result) => total + result.recordCount, 0);
  // プレビューで Scope 1・2 の集計範囲を名乗るラベル。Scope 3 は常に組織全体。
  const scopeRangeLabel = isLocationFilterUsed
    ? `選択拠点（${selectedLocations.length}拠点）`
    : '全拠点';
  const calculationFreshness = describeCalculationFreshness(selectedSummary?.latestBatchStatus);

  const handleToggleLocation = (id: string) => {
    if (selectedLocations.includes(id)) {
      setSelectedLocations(selectedLocations.filter(locId => locId !== id));
    } else {
      setSelectedLocations([...selectedLocations, id]);
    }
  };

  const handleSelectAllLocations = () => {
    if (locations.length > 0 && selectedLocations.length === locations.length) {
      setSelectedLocations([]);
    } else {
      setSelectedLocations(locations.map(location => location.id));
    }
  };

  // 画面で取得済みのデータを渡してレポート本文ビルド時の再取得を避ける。
  // emissionResults は選択年度分しか持たないため、別年度を対象にする場合（履歴からの
  // 再ダウンロード）は渡さず、buildReportDocument 側で当該年度を取り直させる。
  const buildPreloadedData = (targetFiscalYearId: string): ReportData | undefined => (
    targetFiscalYearId === fiscalYearId
      ? {
        fiscalYears,
        locations,
        summaries,
        emissionResults,
        histories: history,
      }
      : undefined
  );

  const handleGenerate = async () => {
    setErrorMessage(null);

    if (isLocationFilterUsed && selectedLocations.length === 0) {
      setErrorMessage('最低1つの拠点を選択してください。');
      return;
    }
    if (!selectedFiscalYear || !selectedSummary) {
      setErrorMessage('対象年度の集計データがありません。先に算定を実行してください。');
      return;
    }

    setIsGenerating(true);

    try {
      if (format === 'csv') {
        // グローバル document とのシャドーイングを避けるため reportDocument と命名する。
        const reportDocument = await buildReportDocument({
          reportType: selectedType,
          reportTypeLabel,
          fiscalYearId: selectedFiscalYear.id,
          format: 'csv',
          locationIds: reportLocationIds,
          preloaded: buildPreloadedData(selectedFiscalYear.id),
        });
        downloadReportCsv(reportDocument);
      } else {
        // PDFは印刷用ビューを新規タブで開き、ブラウザの「PDFとして保存」で出力する。
        // ポップアップブロック等でタブを開けなかった場合は「生成できた」ことにならないよう
        // 履歴に記録せず、ユーザーへ設定変更を案内して終える。
        const opened = openReportPrintView({
          reportType: selectedType,
          fiscalYearId: selectedFiscalYear.id,
          locationIds: reportLocationIds,
        });
        if (!opened) {
          setErrorMessage(POPUP_BLOCKED_MESSAGE);
          return;
        }
      }

      // 出力に成功した後に履歴を記録する（誰が・いつ・どの条件で生成したか）。
      const savedHistory = await createReportGenerationLog({
        reportType: selectedType,
        reportTypeLabel,
        fiscalYearLabel: selectedFiscalYear.label,
        fiscalYearId: selectedFiscalYear.id,
        fiscalYear: selectedFiscalYear.year,
        format,
        locationIds: reportLocationIds,
        scope1Total: selectedScope1Total,
        scope2Total: selectedScope2Total,
        scope3Total: selectedScope3Total,
        totalEmissions: selectedTotalEmissions,
      });

      setHistory(current => [savedHistory, ...current]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'レポートの生成に失敗しました。');
    } finally {
      setIsGenerating(false);
    }
  };

  // 履歴からの再ダウンロード。CSVは記録済み条件から再生成、PDFは印刷ビューを再表示する。
  const handleRedownload = async (report: ReportHistoryItem) => {
    setErrorMessage(null);

    if (!report.reportType || !report.fiscalYearId || !canRedownload(report)) {
      setErrorMessage('この履歴には再生成に必要な出力条件が記録されていません。');
      return;
    }

    if (report.format === 'PDF') {
      const opened = openReportPrintView({
        reportType: report.reportType,
        fiscalYearId: report.fiscalYearId,
        locationIds: report.locationIds,
      });
      if (!opened) {
        setErrorMessage(POPUP_BLOCKED_MESSAGE);
      }
      return;
    }

    setRedownloadingId(report.id);
    try {
      const reportDocument = await buildReportDocument({
        reportType: report.reportType,
        reportTypeLabel: REPORT_TYPE_LABELS[report.reportType],
        fiscalYearId: report.fiscalYearId,
        format: 'csv',
        locationIds: report.locationIds,
        preloaded: buildPreloadedData(report.fiscalYearId),
      });
      downloadReportCsv(reportDocument);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '再ダウンロードに失敗しました。');
    } finally {
      setRedownloadingId(null);
    }
  };

  return (
    <>
      <div className="page-content gt-scroll">
        {/* 年度は「3. 出力オプション」の対象年度で選ぶため、見出しの年度セレクタは出さない
            （同じ fiscalYearId を書く操作が1画面に2つ並ぶのを避ける）。
            主要導線はこの画面自身なので「レポートを作成」ボタンも出さない。 */}
        <PageHeading
          title="レポート"
          description="PDF / CSV の書き出しと生成履歴"
          showFiscalYear={false}
          primaryAction={null}
        />

        {/* Top Info Alert */}
        <div
          className="gt-card flex items-start gap-3"
          style={{ borderLeft: '4px solid var(--color-primary)', backgroundColor: 'var(--color-primary-bg)', marginBottom: '14px' }}
        >
          <Info size={18} className="text-primary shrink-0 mt-0.5" />
          <div style={{ fontSize: '12.5px', color: 'var(--color-text-body)' }}>
            <span className="font-bold text-primary">レポート機能: </span>
            算定・保存済みの排出量データを元に、対象年度・対象拠点のレポートを生成します。CSVはその場でダウンロード、PDFは印刷用ビューを開いてブラウザの「PDFとして保存」で出力できます。生成条件は履歴に記録され、再ダウンロードできます。
          </div>
        </div>

        {errorMessage && (
          <div className="gt-card flex items-start gap-3" style={{ borderLeft: '4px solid var(--color-danger)', backgroundColor: 'var(--color-danger-light)', marginBottom: '14px' }}>
            <AlertCircle size={20} className="text-danger shrink-0 mt-0.5" />
            <div className="text-sm font-semibold text-danger">{errorMessage}</div>
          </div>
        )}

        {isLoading && (
          <Card className="flex items-center justify-center py-10">
            <LoadingIndicator label="レポート対象データを取得しています..." />
          </Card>
        )}

        {!isLoading && (
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] items-start" style={{ gap: '14px' }}>

          {/* Left Column: Report Type & Config */}
          <div className="flex flex-col" style={{ gap: '14px' }}>

            {/* 1. Report Type Selection */}
            <Card className="flex flex-col gap-4">
              <div className="gt-step-head">
                <div className="flex items-center" style={{ gap: '11px' }}>
                  <span className="gt-step-number">1</span>
                  <h2 className="gt-card-title">レポートの種類を選択</h2>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {reportTypes.map((type) => {
                  const Icon = type.icon;
                  const isSelected = selectedType === type.id;
                  return (
                    <div
                      key={type.id}
                      onClick={() => setSelectedType(type.id)}
                      className={`flex gap-4 border rounded-md cursor-pointer transition-all duration-200 ${
                        isSelected
                          ? 'border-primary bg-[var(--color-primary-bg)]'
                          : 'border-border hover:border-text-muted bg-transparent'
                      }`}
                      style={{ padding: '1.5rem' }}
                    >
                      <div
                        style={{ backgroundColor: type.bg, color: type.color }}
                        className="flex items-center justify-center rounded-lg w-12 h-12 shrink-0"
                      >
                        <Icon size={24} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-text-main">{type.title}</span>
                          <span className={`gt-pill gt-pill-sm ${isSelected ? "gt-pill-good" : "gt-pill-neutral"}`}>
                            {type.badge}
                          </span>
                        </div>
                        <p className="text-xs text-text-muted leading-relaxed">{type.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* 2. Target Locations */}
            <Card className="flex flex-col gap-4">
              <div className="gt-step-head">
                <div className="flex items-center" style={{ gap: '11px' }}>
                  <span className="gt-step-number">2</span>
                  <h2 className="gt-card-title">対象拠点の選択</h2>
                </div>
                <button
                  type="button"
                  onClick={handleSelectAllLocations}
                  disabled={locations.length === 0 || !isLocationFilterUsed}
                  className="gt-btn"
                  style={{ height: '30px', padding: '0 11px', fontSize: '12px' }}
                >
                  {locations.length > 0 && selectedLocations.length === locations.length ? '全解除' : '全選択'}
                </button>
              </div>

              {/* Scope 3 詳細では拠点選択が効かないことを、選択 UI を無効化して明示する。 */}
              {!isLocationFilterUsed && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-bg-main p-3 text-xs text-text-muted">
                  <Info size={16} className="text-primary shrink-0" />
                  <span>
                    {reportTypeLabel}は{ORGANIZATION_WIDE_TARGET_LABEL}（組織・年度単位）の集計です。拠点の選択は使いません。
                  </span>
                </div>
              )}

              <div
                className="border border-border rounded-md overflow-hidden max-h-[200px] overflow-y-auto"
                aria-disabled={!isLocationFilterUsed}
                style={!isLocationFilterUsed ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
              >
                <table className="gt-table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '48px', padding: '8px 12px' }}>選択</th>
                      <th style={{ padding: '8px 12px' }}>拠点名</th>
                      <th style={{ padding: '8px 12px' }}>種別</th>
                      <th style={{ padding: '8px 12px' }}>地域</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc) => {
                      const isChecked = selectedLocations.includes(loc.id);
                      return (
                        <tr
                          key={loc.id}
                          onClick={() => handleToggleLocation(loc.id)}
                          className="gt-row-link"
                          style={{ backgroundColor: isChecked ? 'var(--color-primary-light)' : undefined }}
                        >
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={!isLocationFilterUsed}
                              onChange={() => {}} // Controlled by tr onClick
                              className="accent-primary cursor-pointer"
                            />
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 600 }}>{loc.name}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span className="gt-pill gt-pill-sm gt-pill-neutral">{loc.typeLabel}</span>
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{loc.regionLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-text-muted flex justify-between items-center">
                {isLocationFilterUsed ? (
                  <span>選択中: <strong>{selectedLocations.length}</strong> / {locations.length} 拠点</span>
                ) : (
                  <span>対象: <strong>{ORGANIZATION_WIDE_TARGET_LABEL}</strong></span>
                )}
                {isLocationFilterUsed && selectedLocations.length === 0 && (
                  <span className="flex items-center gap-1 text-danger font-bold">
                    <AlertCircle size={14} />
                    拠点を1つ以上選択してください
                  </span>
                )}
              </div>
            </Card>

          </div>

          {/* Right Column: Configurations & Action */}
          <div className="flex flex-col" style={{ gap: '14px' }}>

            {/* 出力内容のプレビュー。
                操作ステップ（1〜3）ではなく「いまの選択でレポートに何が載るか」の受動的な表示なので
                番号は付けず、見出しとリード文で目的を名乗る。 */}
            <Card>
              {/* Card は data 属性を通さないため、テストの目印は内側の section に付ける。 */}
              <section className="flex flex-col gap-4" aria-labelledby="report-preview-heading" data-testid="report-preview">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center" style={{ gap: '9px' }}>
                    <Eye size={16} className="text-primary" />
                    <h2 id="report-preview-heading" className="gt-card-title">出力内容のプレビュー</h2>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">
                    現在の選択（種類・拠点・年度）でレポートに載る排出量です。出力前に内容を確認してください。
                  </p>
                </div>

                {selectedSummary ? (
                  <div className="flex flex-col gap-3 text-xs">
                    {/* 合計は「選択拠点 Scope 1・2 + 組織全体 Scope 3」という異質な集計の足し算のため、
                        内訳を数字の直下に置いて「選択した対象の合計」と誤読させない。 */}
                    <div className="rounded-md border border-border p-3">
                      <div className="text-text-muted mb-1">レポートに載る合計（{selectedSummary.fiscalYearLabel}）</div>
                      <div className="font-bold text-base">{formatEmissions(selectedTotalEmissions)}</div>
                      <div className="text-[11px] text-text-muted mt-1">
                        = {scopeRangeLabel} Scope 1・2 + {ORGANIZATION_WIDE_TARGET_LABEL} Scope 3
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-border p-3">
                        <div className="text-text-muted mb-1">Scope 1 / 2（{scopeRangeLabel}）</div>
                        <div className="font-bold">{formatEmissions(selectedScope1Total)} / {formatEmissions(selectedScope2Total)}</div>
                        <div className="text-[11px] text-text-muted mt-1">算定済みレコード {selectedScope12RecordCount.toLocaleString('ja-JP')} 件</div>
                      </div>
                      <div className="rounded-md border border-border p-3">
                        <div className="text-text-muted mb-1">Scope 3（{ORGANIZATION_WIDE_TARGET_LABEL}）</div>
                        <div className="font-bold">{formatEmissions(selectedScope3Total)}</div>
                        <div className="text-[11px] text-text-muted mt-1">{selectedSummary.scope3CategoryCount} カテゴリ</div>
                      </div>
                    </div>

                    {/* 鮮度: 算定が完了していれば時刻だけを控えめに出し、実行中・失敗・記録なしのときだけ
                        警告スタイルで「レポートに何が起きるか」を説明する。 */}
                    {calculationFreshness.level === 'ok' ? (
                      <div className="text-[11px] text-text-muted" data-testid="report-preview-freshness">
                        {calculationFreshness.statusLabel}: {formatDateTime(selectedSummary.latestBatchCompletedAt)}
                        <span className="mx-2">/</span>
                        集計の最終更新: {formatDateTime(selectedSummary.latestAggregateUpdatedAt)}
                      </div>
                    ) : (
                      <div
                        className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft p-3 text-text-body"
                        data-testid="report-preview-freshness"
                        role="status"
                      >
                        <AlertCircle size={16} className="text-warning shrink-0 mt-0.5" />
                        <div className="flex flex-col gap-1">
                          <div className="font-bold">
                            {calculationFreshness.statusLabel}
                            <span className="font-normal text-text-muted">
                              {' '}（集計の最終更新: {formatDateTime(selectedSummary.latestAggregateUpdatedAt)}）
                            </span>
                          </div>
                          <div className="leading-relaxed">{calculationFreshness.message}</div>
                        </div>
                      </div>
                    )}

                    {/* 拠点を絞れる種別でだけ「Scope 3 は拠点で絞れない」を補足する。
                        拠点選択を使わない種別では全てが組織全体なので、この注記は不要。 */}
                    {isLocationFilterUsed && (
                      <div className="rounded-md border border-border bg-bg-card px-3 py-2 text-[11px] text-text-muted">
                        Scope 3 は拠点別ではなく組織・年度単位で集計しているため、拠点を絞っても Scope 3 は組織全体の値が載ります。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-3 text-xs text-text-muted">
                    <AlertCircle size={16} className="text-warning shrink-0" />
                    選択中の年度にレポート対象の集計データがありません。先に算定処理・集計処理を実行してください。
                  </div>
                )}
              </section>
            </Card>

            {/* 3. Output Options */}
            <Card className="flex flex-col gap-5">
              <div className="gt-step-head">
                <div className="flex items-center" style={{ gap: '11px' }}>
                  <span className="gt-step-number">3</span>
                  <h2 className="gt-card-title">出力オプション</h2>
                </div>
              </div>

              {/* Fiscal Year Option */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-text-muted flex items-center gap-1">
                  <Calendar size={14} />
                  対象年度
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {fiscalYears.map(year => (
                    <button
                      key={year.id}
                      onClick={() => setFiscalYearId(year.id)}
                      type="button"
                      className={fiscalYearId === year.id ? 'gt-btn-primary' : 'gt-btn'}
                      style={{ fontSize: '12px' }}
                    >
                      {year.label}{isCurrentFiscalYear(year) ? ' (現在)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Format Option */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-text-muted flex items-center gap-1">
                  <FileText size={14} />
                  出力フォーマット
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setFormat('pdf')}
                    type="button"
                    className="gt-btn"
                    style={{
                      fontSize: '12px',
                      borderColor: format === 'pdf' ? 'var(--color-primary)' : undefined,
                      backgroundColor: format === 'pdf' ? 'var(--color-primary-bg)' : undefined,
                      color: format === 'pdf' ? 'var(--color-primary-dark)' : undefined,
                      fontWeight: format === 'pdf' ? 600 : 500,
                    }}
                  >
                    <FileText size={15} /> 印刷用PDF
                  </button>
                  <button
                    onClick={() => setFormat('csv')}
                    type="button"
                    className="gt-btn"
                    style={{
                      fontSize: '12px',
                      borderColor: format === 'csv' ? 'var(--color-primary)' : undefined,
                      backgroundColor: format === 'csv' ? 'var(--color-primary-bg)' : undefined,
                      color: format === 'csv' ? 'var(--color-primary-dark)' : undefined,
                      fontWeight: format === 'csv' ? 600 : 500,
                    }}
                  >
                    <FileSpreadsheet size={15} /> CSV (.csv) Excel対応
                  </button>
                </div>
              </div>

              <hr className="border-none border-t border-border" />

              {/* Execution panel */}
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={
                    isLoading
                    || isGenerating
                    || (isLocationFilterUsed && selectedLocations.length === 0)
                    || !selectedSummary
                  }
                  type="button"
                  className="gt-btn-primary w-full"
                  style={{ height: '42px', fontSize: '13.5px' }}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" /> レポートを生成中...
                    </>
                  ) : (
                    <>
                      <Download size={18} /> {format === 'pdf' ? '印刷用PDFビューを開く' : 'CSVをダウンロード'}
                    </>
                  )}
                </button>

                <p className="text-[10px] text-text-muted text-center leading-normal">
                  ※ CSVはExcelでそのまま開ける形式（UTF-16LE・BOM付き・タブ区切り）で出力します。他システムへ取り込む場合はこの形式に合わせてください。PDFは新規タブで印刷用ビューを開き、印刷ダイアログの「PDFとして保存」で出力してください。生成条件は履歴に記録されます。
                </p>
              </div>
            </Card>

            {/* Generated Reports History */}
            <Card className="flex flex-col gap-4">
              <div className="flex items-center" style={{ gap: '9px' }}>
                <Clock size={16} className="text-primary" />
                <h2 className="gt-card-title">レポート生成履歴</h2>
              </div>

              <div className="flex flex-col gap-3">
                {history.length > 0 ? (
                  history.map((rep) => (
                    /* E2Eスモークが「レポート生成が履歴に1件増えたか」を数えるための目印。
                       seed に既存履歴があるため空表示の有無では検証できず、行単位の目印が要る。 */
                    <div
                      key={rep.id}
                      data-testid="report-history-item"
                      className="flex justify-between items-center gap-3 py-3 px-1 border-b border-border-light hover:bg-bg-main transition-colors"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="font-bold text-xs text-text-main flex items-center gap-2">
                          {rep.format === 'PDF' ? (
                            <FileText size={14} className="text-danger shrink-0" />
                          ) : (
                            <FileSpreadsheet size={14} className="text-success shrink-0" />
                          )}
                          <span className="truncate">{rep.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-text-muted mt-1 [&>span]:whitespace-nowrap">
                          <span>{rep.generatedAt}</span>
                          <span>•</span>
                          <span>{rep.type}</span>
                          <span>•</span>
                          <span>{rep.fiscalYear}</span>
                          <span>•</span>
                          <span>{rep.targetSummary}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="gt-btn shrink-0"
                        style={{ padding: '0 10px', height: '26px', fontSize: '11px' }}
                        onClick={() => handleRedownload(rep)}
                        disabled={redownloadingId === rep.id || !canRedownload(rep)}
                        title={!canRedownload(rep) ? '出力条件が記録されていないため再生成できません' : '再ダウンロード'}
                      >
                        {redownloadingId === rep.id ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Download size={10} />
                        )}
                        {rep.format === 'PDF' ? '再表示' : 'DL'}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="flex items-start gap-2 rounded-md border border-border bg-bg-main p-3 text-xs text-text-muted">
                    <Info size={16} className="text-primary shrink-0" />
                    まだレポート生成リクエスト履歴はありません。
                  </div>
                )}
              </div>
            </Card>

          </div>

          </div>
        )}

      </div>
    </>
  );
};
