'use client';

// ダッシュボードの「削減目標」カード。
// 目標は「基準年度 + 年度ごとの削減率(%)」で持ち、ある年度の年間目標排出量は
// 「基準年度の実績 × (1 - その年度の削減率/100)」として導出する。
// 表示年度の実績・目標消化率を1枚で見せ、同じカードから目標を編集できる。
// 削減目標は排出量の上限なので、目標消化率（実績 ÷ 目標）は「低いほど順調・100% 超で超過」。
// 一般的な「達成率」（高いほど良い）と向きが逆で誤読されやすいため、この名称と注記で方向を示す。
// 数値の正本は dashboard_aggregates（＝KPIカードと同じ）なので、カード間で値が食い違わない。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, Pencil, Target } from 'lucide-react';
import clsx from 'clsx';
import { Modal } from '@/components/ui/Modal.client';
import { getFiscalYearStartMonthFromDate, isFiscalYearEnded } from '@/lib/fiscal-year/fiscalYearPeriod';
import {
  BASE_YEAR_EMISSIONS_MISSING_MESSAGE,
  buildAnnualStatusBadge,
  buildProgressBarView,
  buildTargetYearRange,
  buildUnendedBaseYearNotice,
  calculateChangeFromBaseYear,
  calculateTargetEmissions,
  formatChangeFromBaseYear,
  getChangeFromBaseYearTone,
  getFiscalYearStartYearFromDate,
  getTargetFiscalYearStartYear,
  isBaseYearEmissionsUsable,
  isValidReductionPercentInput,
  MAX_REDUCTION_PERCENT,
  parseReductionPercentInput,
  type AnnualProgress,
} from '../services/targetAggregation';
import {
  clearReductionTarget,
  getFiscalYearTotalEmissions,
  getTargetProgress,
  saveReductionTarget,
  type FiscalYearRef,
  type ReductionTargetYear,
  type TargetProgressData,
} from '../services/targetService';

const numberFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 });
const percentFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

/** 親（ダッシュボード）へ渡す目標のサマリー。月別・年度別グラフの目標ラインに使う。 */
export type ReductionTargetSummary = {
  /** 表示中の年度の年間目標。未設定は null */
  annualTarget: number | null;
  /** 年度の開始年 → 年間目標排出量（年度別グラフの目標ライン用） */
  targetsByYear: Record<number, number>;
};

const EMPTY_SUMMARY: ReductionTargetSummary = { annualTarget: null, targetsByYear: {} };

/** 年間実績に添える「基準年度比」の文言と色。 */
type BaseYearComparisonView = { label: string; color: string };

// 表示中の年度が基準年度そのものなら比較は意味を持たない（実績 = 分母）ので、その旨を中立色で出す。
// 増減率が出せない（基準年度の実績が 0）ときも中立色で「—」。削減は良い（success）、増加は悪い（danger）、
// 丸めて 0 になる「変化なし」はどちらでもないので中立色にする。
//
// 色による良し悪しの断定は、次の2つの場合には行わず中立色にする（比較値そのものは出す）。
// - 期中: 分子が期中累計・分母は基準年度の通年実績のため、年度が終わるまでは実態より大きな削減に見える
//   （期首・未入力なら実績 0 →「▲100.0%」＝ネットゼロ達成の見た目）。「（期中）」を添えて途中経過だと示す。
//   達成状況ピルの「達成／未達は年度終了後のみ」（buildAnnualStatusBadge）と同じ整理
// - 基準年度より前の年度: 削減パスの対象外で、増えている＝悪いという評価が成り立たない
const buildBaseYearComparisonView = ({
  baseFiscalYearLabel,
  isBaseYearShown,
  isBeforeBaseYear,
  fiscalYearEnded,
  changePercent,
}: {
  baseFiscalYearLabel: string;
  isBaseYearShown: boolean;
  isBeforeBaseYear: boolean;
  fiscalYearEnded: boolean;
  changePercent: number | null;
}): BaseYearComparisonView => {
  const neutral = 'var(--color-text-muted)';
  if (isBaseYearShown) return { label: '基準年度（比較の分母）', color: neutral };
  if (changePercent === null) return { label: `${baseFiscalYearLabel}比 —`, color: neutral };

  const change = `${baseFiscalYearLabel}比 ${formatChangeFromBaseYear(changePercent)}`;
  if (isBeforeBaseYear) return { label: change, color: neutral };
  if (!fiscalYearEnded) return { label: `${change}（期中）`, color: neutral };

  const tone = getChangeFromBaseYearTone(changePercent);
  const color =
    tone === 'reduced' ? 'var(--color-success)' : tone === 'increased' ? 'var(--color-danger)' : neutral;
  return { label: change, color };
};

const ProgressBar = ({ progress }: { progress: AnnualProgress }) => {
  // トラック全体＝年間目標。目標消化率が100%を超えた分はバーからはみ出せないため、
  // バーを満杯＋ダンジャー色にしたうえで超過量を数字で添える。
  // 目標0（ネットゼロ）は消化率が0除算で出ないため、超過の有無だけでバーを描く（buildProgressBarView）。
  const { filledPercent, exceeded, overshootPercent, remainingPercent } = buildProgressBarView(progress);
  // 残り枠・超過量は t-CO2e で示し、率は補足として添える。「残り 45%」だけでは何の 45% か
  // 分かりにくく、量があれば「あと何 t 出せるか」として読める。
  // remainingEmissions（目標 − 実績）は超過時に負になるため、超過量は符号を反転した別名で持つ。
  const remainingEmissions = progress.remainingEmissions ?? 0;
  const overshootAmount = exceeded ? -remainingEmissions : 0;
  const overshootLabel = `目標を ${numberFormatter.format(overshootAmount)} t-CO2e${
    overshootPercent !== null ? `（${overshootPercent.toFixed(1)}%）` : ' '
  }超過`;
  const remainingLabel = `残り枠 ${numberFormatter.format(remainingEmissions)} t-CO2e${
    remainingPercent !== null ? `（${remainingPercent.toFixed(1)}%）` : ''
  }`;

  return (
    <div style={{ marginTop: '18px' }}>
      <div
        className="rounded-full"
        style={{
          height: '10px',
          backgroundColor: 'var(--color-chart-track)',
          overflow: 'hidden',
        }}
      >
        <div
          className="rounded-full"
          style={{
            width: `${filledPercent}%`,
            height: '100%',
            backgroundColor: progress.withinTarget ? 'var(--color-success)' : 'var(--color-danger)',
            transition: 'width .5s cubic-bezier(.2,.7,.2,1)',
          }}
        />
      </div>
      <div className="flex justify-between" style={{ marginTop: '7px', fontSize: '11.5px', color: 'var(--color-text-subtle)' }}>
        <span>0</span>
        {exceeded ? (
          <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>{overshootLabel}</span>
        ) : (
          <span>{remainingLabel}</span>
        )}
        <span>
          目標 {numberFormatter.format(progress.annualTarget ?? 0)} t-CO2e
        </span>
      </div>
    </div>
  );
};

const Metric = ({
  label,
  value,
  unit,
  note,
  muted = false,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: ReactNode;
  muted?: boolean;
}) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{label}</div>
    <div className="flex items-baseline" style={{ gap: '7px', marginTop: '9px' }}>
      <span
        style={{
          fontSize: '28px',
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-0.025em',
          color: muted ? 'var(--color-text-subtle)' : 'var(--color-text-heading)',
        }}
      >
        {value}
      </span>
      {unit && <span style={{ fontSize: '12.5px', color: 'var(--color-text-subtle)' }}>{unit}</span>}
    </div>
    {note && <div style={{ marginTop: '9px', fontSize: '12px', color: 'var(--color-text-subtle)' }}>{note}</div>}
  </div>
);

export const ReductionTargetCard = ({
  fiscalYearId,
  fiscalYearLabel,
  period,
  fiscalYears,
  refreshToken,
  onTargetChange,
}: {
  fiscalYearId: string | null;
  fiscalYearLabel: string;
  period: { startDate: string; endDate: string } | null;
  /** 基準年度の選択肢（FiscalYearContext の年度一覧。基準年度の期間解決にも使う） */
  fiscalYears: FiscalYearRef[];
  /** ヘッダーの「最新データに更新」に追随するための連番 */
  refreshToken: number;
  /**
   * 読み込み・保存のたびに現在の目標を親へ渡す（月別・年度別グラフの目標ラインで使う）。
   * 目標未設定・取得失敗時は空のサマリー。
   */
  onTargetChange?: (summary: ReductionTargetSummary) => void;
}) => {
  const [data, setData] = useState<TargetProgressData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [baseFiscalYearIdDraft, setBaseFiscalYearIdDraft] = useState('');
  // 年度の開始年 → 削減率の入力文字列（空欄 = その年度は目標未設定）。
  const [percentDrafts, setPercentDrafts] = useState<Record<number, string>>({});
  // 選択中の基準年度の実績排出量（モーダル内のプレビュー用）。取得中・取得失敗時は null。
  const [baseYearPreview, setBaseYearPreview] = useState<number | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  // 実績の取得に失敗したか。保存前の「基準年度の実績が 0 でないか」の判定に使うため、
  // 「未取得（null）」と「取得失敗」を区別する。
  const [previewFailed, setPreviewFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // 保存成功メッセージは「保存したときに表示していた年度」に紐づける。年度を切り替えたあとも
  // 残すと、別年度の見出しの下に「更新しました」が並んでしまう。
  const [savedNotice, setSavedNotice] = useState<{ fiscalYearId: string; message: string } | null>(null);
  const savedMessage = savedNotice?.fiscalYearId === fiscalYearId ? savedNotice.message : '';

  // 年度切替と保存後の再取得が並走したとき、後着の古い結果で新しい表示を上書きしないよう
  // リクエスト番号で最後の呼び出しだけを反映する。
  const requestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);

  // 削減率を入力する最終年度は「現在の年度 + 5年」。年度の期首月は選択中の年度に合わせる（既定4月）。
  const finalTargetYear = getTargetFiscalYearStartYear(
    new Date(),
    period ? getFiscalYearStartMonthFromDate(period.startDate) : null,
  );
  const finalTargetYearLabel = `${finalTargetYear}年度`;

  const loadProgress = useCallback(
    async (targetFiscalYearId: string, targetPeriod: { startDate: string; endDate: string }) => {
      const requestId = ++requestIdRef.current;
      // 年度切替・再取得の間は前回の数値を保持して表示し続ける（stale-while-revalidate）。
      // その間に isLoading を立てないと、切替後の見出しの下に前年度の数値が確定値の顔で並ぶ。
      setIsLoading(true);
      try {
        const result = await getTargetProgress(targetFiscalYearId, targetPeriod, fiscalYears);
        if (requestIdRef.current !== requestId) return;
        setData(result);
        setErrorMessage('');
        // 基準年度の実績が 0 の目標は全年度 0 になり、グラフの目標ラインとして意味が無いため親へ渡さない
        // （カード側は注記表示に切り替える）。
        const usable = result.target ? isBaseYearEmissionsUsable(result.target.baseYearEmissions) : false;
        onTargetChange?.(
          usable
            ? {
                annualTarget: result.annualProgress.annualTarget,
                targetsByYear: result.target?.targetsByYear ?? {},
              }
            : EMPTY_SUMMARY,
        );
      } catch (error) {
        if (requestIdRef.current !== requestId) return;
        setData(null);
        setErrorMessage(error instanceof Error ? error.message : '削減目標の取得に失敗しました');
        onTargetChange?.(EMPTY_SUMMARY);
      } finally {
        if (requestIdRef.current === requestId) setIsLoading(false);
      }
    },
    [fiscalYears, onTargetChange],
  );

  useEffect(() => {
    if (!fiscalYearId || !period) return;

    const load = async () => {
      await loadProgress(fiscalYearId, period);
    };

    void load();
  }, [fiscalYearId, period, refreshToken, loadProgress]);

  // モーダルで選び直した基準年度の実績を引き直し、保存前に各年度の目標排出量を確認できるようにする。
  useEffect(() => {
    const baseYear = isEditOpen
      ? fiscalYears.find(year => year.id === baseFiscalYearIdDraft) ?? null
      : null;
    const requestId = ++previewRequestIdRef.current;

    const loadPreview = async () => {
      if (!baseYear) {
        setBaseYearPreview(null);
        setPreviewFailed(false);
        return;
      }

      setIsPreviewLoading(true);
      setPreviewFailed(false);
      try {
        const result = await getFiscalYearTotalEmissions(baseYear.id, baseYear);
        if (previewRequestIdRef.current === requestId) setBaseYearPreview(result.total);
      } catch {
        // 実績が取れないと「基準年度の実績が 0 でないか」を確かめられないため、保存もできない
        // （handleSave 参照）。取得失敗を明示して、再選択・再試行を促す。
        if (previewRequestIdRef.current === requestId) {
          setBaseYearPreview(null);
          setPreviewFailed(true);
        }
      } finally {
        if (previewRequestIdRef.current === requestId) setIsPreviewLoading(false);
      }
    };

    void loadPreview();
  }, [isEditOpen, baseFiscalYearIdDraft, fiscalYears]);

  // 削減率を入力する年度（基準年度の翌年度〜最終目標年度）。
  const baseYearDraft = fiscalYears.find(year => year.id === baseFiscalYearIdDraft) ?? null;
  // 選択中の基準年度がまだ終了していない（期中・未来）。分母が確定しておらず、保存後も
  // 目標排出量が動くため注意書きを出す（保存自体は許す。buildUnendedBaseYearNotice 参照）。
  const isBaseYearDraftUnended = baseYearDraft !== null && !isFiscalYearEnded(baseYearDraft);
  const editableYears = useMemo(
    () =>
      baseYearDraft
        ? buildTargetYearRange(
            getFiscalYearStartYearFromDate(baseYearDraft.startDate),
            finalTargetYear,
          )
        : [],
    [baseYearDraft, finalTargetYear],
  );

  const openEdit = () => {
    const saved = data?.target ?? null;
    // 既定の基準年度は「保存済み → 最も古い登録年度」。削減目標の基準年は過去年度を指すのが普通。
    setBaseFiscalYearIdDraft(saved?.baseFiscalYear.id ?? fiscalYears[fiscalYears.length - 1]?.id ?? '');
    setPercentDrafts(
      Object.fromEntries(
        (saved?.targetYears ?? []).map(entry => [entry.targetYear, String(entry.reductionPercent)]),
      ),
    );
    setSaveError('');
    setSavedNotice(null);
    setIsEditOpen(true);
  };

  const handleSave = async () => {
    if (!fiscalYearId || !period) return;

    const invalidYear = editableYears.find(
      year => !isValidReductionPercentInput(percentDrafts[year] ?? ''),
    );
    if (invalidYear !== undefined) {
      setSaveError(
        `${invalidYear}年度の削減率は 0〜${MAX_REDUCTION_PERCENT} の範囲・小数第2位までの数値で入力してください`,
      );
      return;
    }

    // 入力欄に出ていない年度（基準年度を変えて範囲外になった年度）は保存対象から外す。
    const entries: ReductionTargetYear[] = editableYears
      .map(year => ({ targetYear: year, reductionPercent: parseReductionPercentInput(percentDrafts[year] ?? '') }))
      .filter((entry): entry is ReductionTargetYear => entry.reductionPercent !== null);

    if (entries.length > 0 && !baseYearDraft) {
      setSaveError('基準年度を選択してください');
      return;
    }

    // 基準年度の実績が 0（未算定）だと全年度の目標が 0 になり「未達」しか出ないため、
    // 削減率を1つでも入れて保存するときは実績が正の値であることを必須にする。
    // すべて空欄（＝目標の削除）は実績に関係なく通す。
    if (entries.length > 0) {
      if (isPreviewLoading) {
        setSaveError('基準年度の実績を読み込んでいます。読み込みが終わってから保存してください');
        return;
      }
      if (previewFailed || baseYearPreview === null) {
        setSaveError('基準年度の実績を取得できなかったため保存できません。時間をおいて再度お試しください');
        return;
      }
      if (!isBaseYearEmissionsUsable(baseYearPreview)) {
        setSaveError(BASE_YEAR_EMISSIONS_MISSING_MESSAGE);
        return;
      }
    }

    setIsSaving(true);
    setSaveError('');
    try {
      if (entries.length === 0) {
        await clearReductionTarget();
      } else {
        await saveReductionTarget(baseFiscalYearIdDraft, entries);
      }
      // 保存後は目標消化率まで組み立て直したいので、画面側で計算せずサーバから取り直す。
      setIsEditOpen(false);
      setSavedNotice({
        fiscalYearId,
        message:
          entries.length === 0
            ? '削減目標を未設定に戻しました'
            : `削減目標を ${entries.length} 年度分（${baseYearDraft?.label ?? ''}比）に更新しました`,
      });
      await loadProgress(fiscalYearId, period);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '削減目標の保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  const progress = data?.annualProgress ?? null;
  const target = data?.target ?? null;
  const hasTarget = progress?.hasTarget ?? false;
  // 保存後に基準年度の算定結果が消えた／未算定のまま保存されていた場合。枠内/超過の判定は
  // 意味を持たないため、ピルと進捗バーの代わりに注記を出す。
  const baseYearUnusable = target !== null && !isBaseYearEmissionsUsable(target.baseYearEmissions);
  // 保存済みの基準年度がまだ終了していない場合。分母が月々増えるため、カードの年間目標も
  // 年度別グラフの目標ラインも設定を変えないまま動く。数値の隣でその旨を示す。
  const baseYearUnended = target !== null && !isFiscalYearEnded(target.baseFiscalYear);
  // 年度が1件も無い（初期セットアップ前）ときは読み込みが始まらないため、
  // 「読み込んでいます...」を出し続けず静かな空状態にする。
  const hasFiscalYear = fiscalYearId !== null && period !== null && fiscalYears.length > 0;
  // 前回の数値を表示したまま再取得している状態。初回（data が無い）は読み込み中テキストを出す。
  const isRefreshing = isLoading && data !== null;
  // 目標 0（ネットゼロ）は目標消化率（実績 ÷ 目標）を計算できない。ピルの枠内/超過判定はそのまま使う。
  const isZeroTarget = hasTarget && progress?.annualTarget === 0;
  const fiscalYearEnded = period !== null && isFiscalYearEnded(period);
  // 達成状況ピルは、年度が終わるまで「達成」と断定しない（期中は「枠内で推移中」）。
  const statusBadge = progress && !baseYearUnusable ? buildAnnualStatusBadge(progress, fiscalYearEnded) : null;
  // 実績側の基準年度比。目標の「基準年度比◯%削減」と同じ物差しで、実績がどれだけ減ったかを併記する。
  const isBaseYearShown = target !== null && target.baseFiscalYear.id === fiscalYearId;
  // 基準年度より前の年度（削減パスの対象外）。年度は開始年で識別する。
  const isBeforeBaseYear =
    target !== null &&
    period !== null &&
    getFiscalYearStartYearFromDate(period.startDate) <
      getFiscalYearStartYearFromDate(target.baseFiscalYear.startDate);
  const baseYearComparison =
    target && progress
      ? buildBaseYearComparisonView({
          baseFiscalYearLabel: target.baseFiscalYear.label,
          isBaseYearShown,
          isBeforeBaseYear,
          fiscalYearEnded,
          changePercent: isBaseYearShown
            ? null
            : calculateChangeFromBaseYear(target.baseYearEmissions, progress.cumulativeActual),
        })
      : null;
  const actualSourceNote =
    data?.actualSource === 'aggregate'
      ? '算定確定値（Scope 3 の年次集計を含む）'
      : '算定結果の合算（集計は未確定）';

  return (
    <section className="gt-card">
      <div className="gt-card-head">
        <div className="flex items-center" style={{ gap: '9px' }}>
          <Target size={17} strokeWidth={1.85} style={{ color: 'var(--color-primary)', flex: 'none' }} />
          <div>
            <h2 className="gt-card-title">削減目標</h2>
            <p className="gt-card-sub">
              {fiscalYearLabel}・年間目標に対する進捗
              {data?.actualSource === 'monthly' && '（実績は算定結果の合算）'}
            </p>
          </div>
        </div>
        <div className="flex items-center" style={{ gap: '12px', flex: 'none' }}>
          {/* 再取得中は前回の数値を保持して表示しているため、確定値と誤認させないよう明示する。
              KPI帯の RefreshingIndicator は絶対配置で編集ボタンと重なるため、ここはインラインで出す。 */}
          {isRefreshing && (
            <span
              role="status"
              aria-live="polite"
              className="flex items-center"
              style={{ gap: '6px', fontSize: '12px', color: 'var(--color-text-subtle)' }}
            >
              <Loader2 size={13} className="animate-spin" />
              更新中…（表示中の数値は前回の内容です）
            </span>
          )}
          <button
            type="button"
            className="gt-btn"
            onClick={openEdit}
            disabled={!fiscalYearId || isLoading || fiscalYears.length === 0}
          >
            <Pencil size={15} strokeWidth={1.9} />
            {target ? '目標を変更' : '目標を設定'}
          </button>
        </div>
      </div>

      {errorMessage && (
        <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--color-danger)' }}>{errorMessage}</p>
      )}

      {savedMessage && (
        <p role="status" style={{ marginTop: '14px', fontSize: '12.5px', color: 'var(--color-success)' }}>
          {savedMessage}
        </p>
      )}

      {!hasFiscalYear && (
        <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--color-text-subtle)' }}>
          算定年度が登録されていないため、削減目標はまだ設定できません。
        </p>
      )}

      {hasFiscalYear && !errorMessage && isLoading && !progress && (
        <p style={{ marginTop: '18px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
          削減目標を読み込んでいます...
        </p>
      )}

      {hasFiscalYear && !errorMessage && progress && (
        <div
          aria-busy={isRefreshing}
          style={{ opacity: isRefreshing ? 0.55 : 1, transition: 'opacity .2s ease' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '20px',
              marginTop: '18px',
            }}
          >
            <Metric
              label="基準年度排出量"
              value={target ? numberFormatter.format(target.baseYearEmissions) : '未設定'}
              unit={target ? 't-CO2e' : undefined}
              note={
                target ? (
                  <>
                    {`${target.baseFiscalYear.label}の実績${
                      target.baseYearSource === 'monthly' ? '（算定結果の合算）' : ''
                    }`}
                    {baseYearUnended && (
                      <span style={{ display: 'block', marginTop: '3px', color: 'var(--color-warning)' }}>
                        {buildUnendedBaseYearNotice(target.baseFiscalYear.label)}
                      </span>
                    )}
                  </>
                ) : (
                  '基準年度が設定されていません'
                )
              }
              muted={!target}
            />
            <Metric
              label={`年間目標（${fiscalYearLabel}）`}
              value={hasTarget ? numberFormatter.format(progress.annualTarget ?? 0) : '未設定'}
              unit={hasTarget ? 't-CO2e' : undefined}
              note={
                target && target.currentReductionPercent !== null
                  ? `${target.baseFiscalYear.label}比 ${percentFormatter.format(target.currentReductionPercent)}% 削減`
                  : target
                    ? `${fiscalYearLabel}の削減率が設定されていません`
                    : 'この組織の削減目標はまだ設定されていません'
              }
              muted={!hasTarget}
            />
            <Metric
              label="年間実績（累計）"
              value={numberFormatter.format(progress.cumulativeActual)}
              unit="t-CO2e"
              note={
                baseYearComparison ? (
                  <>
                    <span style={{ display: 'block', fontWeight: 600, color: baseYearComparison.color }}>
                      {baseYearComparison.label}
                    </span>
                    {actualSourceNote}
                  </>
                ) : (
                  actualSourceNote
                )
              }
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>目標消化率</div>
              <div className="flex items-baseline" style={{ gap: '9px', marginTop: '9px' }}>
                <span
                  style={{
                    fontSize: '28px',
                    fontWeight: 600,
                    lineHeight: 1,
                    letterSpacing: '-0.025em',
                    color: hasTarget && !baseYearUnusable ? 'var(--color-text-heading)' : 'var(--color-text-subtle)',
                  }}
                >
                  {progress.consumptionRate === null || baseYearUnusable
                    ? '—'
                    : `${progress.consumptionRate.toFixed(1)}%`}
                </span>
                {statusBadge && (
                  <span
                    className={clsx('gt-pill', statusBadge.tone === 'good' ? 'gt-pill-good' : 'gt-pill-bad')}
                  >
                    {statusBadge.label}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: '9px',
                  fontSize: '12px',
                  color: baseYearUnusable ? 'var(--color-danger)' : 'var(--color-text-subtle)',
                }}
              >
                {baseYearUnusable
                  ? BASE_YEAR_EMISSIONS_MISSING_MESSAGE
                  : isZeroTarget
                    ? '目標が 0（ネットゼロ）のため目標消化率は計算できません'
                    : '目標に対して使った排出量の割合（低いほど順調）'}
              </div>
            </div>
          </div>

          {hasTarget && !baseYearUnusable && <ProgressBar progress={progress} />}
        </div>
      )}

      <Modal
        isOpen={isEditOpen}
        onClose={() => {
          if (!isSaving) setIsEditOpen(false);
        }}
        title="削減目標"
        size="lg"
      >
        <div className="flex flex-col" style={{ gap: '16px' }}>
          <p style={{ fontSize: '12.5px', color: 'var(--color-text-muted)', lineHeight: 1.7 }}>
            基準年度を決め、その翌年度から{finalTargetYearLabel}（現在の年度＋5年）までの
            削減率を年度ごとに設定します。各年度の年間目標排出量は
            「基準年度の実績 × (1 − その年度の削減率)」で求めます。
            空欄の年度は「目標未設定」として扱い、すべて空欄で保存すると登録済みの目標は削除されます。
          </p>
          <div>
            <label className="gt-field-label" htmlFor="reduction-target-base-year">
              基準年度
            </label>
            <select
              id="reduction-target-base-year"
              className="gt-field gt-field-select"
              value={baseFiscalYearIdDraft}
              onChange={event => {
                setBaseFiscalYearIdDraft(event.target.value);
                setSaveError('');
              }}
              style={{ maxWidth: '220px' }}
            >
              <option value="">選択してください</option>
              {fiscalYears.map(year => (
                <option key={year.id} value={year.id}>
                  {year.label}
                </option>
              ))}
            </select>
            {isBaseYearDraftUnended && (
              <p
                role="note"
                style={{
                  marginTop: '7px',
                  fontSize: '12px',
                  lineHeight: 1.7,
                  color: 'var(--color-warning)',
                }}
              >
                {buildUnendedBaseYearNotice(baseYearDraft.label)}
              </p>
            )}
            <p
              style={{
                marginTop: '7px',
                fontSize: '12px',
                color:
                  previewFailed || (baseYearPreview !== null && !isBaseYearEmissionsUsable(baseYearPreview))
                    ? 'var(--color-danger)'
                    : 'var(--color-text-subtle)',
              }}
            >
              {isPreviewLoading
                ? '基準年度の実績を読み込んでいます...'
                : previewFailed
                  ? '基準年度の実績を取得できませんでした。年度を選び直すか、時間をおいて再度お試しください。'
                  : baseYearPreview === null
                    ? '基準年度を選ぶと、その年度の実績と各年度の目標排出量を表示します。'
                    : isBaseYearEmissionsUsable(baseYearPreview)
                      ? `基準年度の実績 ${numberFormatter.format(baseYearPreview)} t-CO2e${
                          isBaseYearDraftUnended ? '（期中の累計）' : ''
                        }`
                      : BASE_YEAR_EMISSIONS_MISSING_MESSAGE}
            </p>
          </div>

          <div>
            <span className="gt-field-label">年度ごとの削減率（基準年度比）</span>
            {editableYears.length === 0 ? (
              <p style={{ fontSize: '12.5px', color: 'var(--color-text-subtle)' }}>
                {baseYearDraft
                  ? `基準年度が${finalTargetYearLabel}以降のため、設定できる年度がありません。`
                  : '基準年度を選ぶと、年度ごとの削減率を入力できます。'}
              </p>
            ) : (
              <div className="flex flex-col" style={{ gap: '8px' }}>
                {editableYears.map(year => {
                  const draft = percentDrafts[year] ?? '';
                  const parsed = isValidReductionPercentInput(draft)
                    ? parseReductionPercentInput(draft)
                    : null;
                  const yearTarget =
                    baseYearPreview !== null && parsed !== null
                      ? calculateTargetEmissions(baseYearPreview, parsed)
                      : null;

                  return (
                    <div key={year} className="flex items-center" style={{ gap: '10px' }}>
                      <label
                        htmlFor={`reduction-target-percent-${year}`}
                        style={{ flex: 'none', width: '76px', fontSize: '13px', color: 'var(--color-text-body)' }}
                      >
                        {year}年度
                      </label>
                      <input
                        id={`reduction-target-percent-${year}`}
                        className="gt-field"
                        type="text"
                        inputMode="decimal"
                        value={draft}
                        placeholder="例: 10"
                        onChange={event => {
                          const { value } = event.target;
                          setPercentDrafts(prev => ({ ...prev, [year]: value }));
                          setSaveError('');
                        }}
                        style={{ flex: 'none', width: '110px' }}
                      />
                      <span style={{ flex: 'none', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                        ％ 削減
                      </span>
                      <span
                        className="truncate"
                        style={{ flex: 1, minWidth: 0, fontSize: '12px', color: 'var(--color-text-subtle)' }}
                      >
                        {yearTarget !== null
                          ? `→ 目標 ${numberFormatter.format(yearTarget)} t-CO2e`
                          : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {saveError && <p style={{ fontSize: '12.5px', color: 'var(--color-danger)' }}>{saveError}</p>}
          <div className="flex justify-end" style={{ gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              className="gt-btn"
              onClick={() => setIsEditOpen(false)}
              disabled={isSaving}
            >
              キャンセル
            </button>
            <button type="button" className="gt-btn-primary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? '保存しています...' : '保存'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
};
