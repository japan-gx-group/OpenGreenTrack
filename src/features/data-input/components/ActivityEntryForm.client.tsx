'use client';

// 統合データ入力フォーム。Scope 1・2（emission_factors 参照）と Scope 3 積上げ（IDEA 連携。、
// docs/idea-scope3-spec.md §5.2）を 1 つのフォームで入力する。
// 画面は常に ① 基本情報 → ② 排出係数の参照 → ③ 活動量と計算結果 → ④ 備考 の 4 ブロックで、
// 選択したカテゴリから排出係数の参照方式（services/entryCategory.ts の factorSourceOf）を判定し、
//   - 供給事業者別係数（電気・都市ガス・熱）: 計算方法（基礎/調整後）→ 供給事業者 → メニュー。未選択なら代替値
//   - 標準係数（燃料など）: 算定エンジンと同じ純関数で候補を並べ、先頭を自動選択（変更可）
//   - IDEA 原単位（Scope 3 積上げ）: カテゴリ（1〜15）→ IDEA 製品検索（searchIdeaProducts +
//     SearchableSelect のサーバーサイド検索・debounce）→ 活動量。単位は選択製品から自動設定し編集不可（受け入れ条件）
// を ② の中身だけ切り替える。インライン概算は算定バッチと同じロジック（computeEstimatedEmissions /
// の normalizeIdeaFactor と同一の scope3InlineCalculation）で行い、保存後の算定と同じ値を表示する。
// 構造・バリデーション・未来月ガードは両経路で共有する。

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Trash2, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { SCOPE3_FACTOR_MISSING_MESSAGE } from '@/features/calculation/services/scope3Calculation';
import { scopeAnalysisHref } from '@/features/scope-analysis/utils/scopeAnalysisUrl';
import {
  MANUAL_ACTIVITY_CATEGORY_MAP,
  type ActivityEntryInitialValues,
  type ActivityEntryInput,
  type ManualEntryLocationOption,
} from '../types';
import { useIdeaProductSelection } from '../hooks/useIdeaProductSelection';
import { useKeyedLoader } from '../hooks/useKeyedLoader';
import { useScope12FactorSelection } from '../hooks/useScope12FactorSelection';
import {
  DEFAULT_ENTRY_CATEGORY,
  ENTRY_PATH_LABELS,
  buildEntryCategoryGroups,
  entryCategoryFromInitialValues,
  entryCategoryLabel,
  entryPathOf,
  factorSourceOf,
  formatEntryCategoryValue,
  parseEntryCategoryValue,
  resolveEntryUnit,
  type EntryCategory,
  type EntryMode,
} from '../services/entryCategory';
import {
  amountFieldLabel,
  buildCalculationResultView,
  buildPreviewRows,
  factorSourceRowText,
} from '../services/entryFormat';
import {
  DECIMAL_PATTERN,
  NOTE_MAX_LENGTH,
  SAVE_FAILURE_MESSAGES,
  VALIDATION_MESSAGES,
  amountValidationMessage,
  buildActivityEntryInput,
  validateAmount,
  validateEntry,
} from '../services/entrySubmission';
import {
  applicableYearForDate,
  computeEstimatedEmissions,
  findFiscalYearForDate,
} from '../services/inlineCalculation';
import {
  getScope3CategoryMethod,
  scope3AdoptedCategoryId,
  scope3DirectMethodNoticeText,
  scope3MethodKey,
} from '../services/scope3Adoption';
import {
  MIN_TARGET_MONTH,
  getCurrentYearMonth,
  validateTargetMonth,
} from '../services/manualEntryTargetMonth';
import { computeEstimatedScope3Emissions } from '../services/scope3InlineCalculation';
import { ActivityEntryFactorSection } from './ActivityEntryFactorSection.client';
import { ActivityEntryPreviewModal } from './ActivityEntryPreviewModal.client';
import { EntryCalculationResult } from './EntryCalculationResult';
import { EntryField, EntryNotice, EntrySection, FactorSourceChip, UnitBadge } from './EntryFormPrimitives';

export interface ActivityEntryFormProps {
  locations: ManualEntryLocationOption[];
  /** Scope1/2・Scope3 のどちらでも 1 本で受ける。reject 時は error.message をフォーム内に表示する。 */
  onSave: (entry: ActivityEntryInput) => Promise<void>;
  /** 'create'（新規入力・既定）または 'edit'（履歴編集）。edit ではモーダル内に埋め込む。 */
  mode?: EntryMode;
  /** edit のときの初期値。kind でカテゴリ選択肢の保存経路を固定する。 */
  initialValues?: ActivityEntryInitialValues;
  /** edit のときの閉じる操作（保存成功後にも呼ぶ）。 */
  onCancel?: () => void;
  /** edit のときの削除操作。指定時のみ削除ボタンを表示する。 */
  onDelete?: () => Promise<void>;
  /** 削除処理中フラグ（ボタンの二重押下防止）。 */
  isDeleting?: boolean;
}

export const ActivityEntryForm: React.FC<ActivityEntryFormProps> = ({
  locations,
  onSave,
  mode = 'create',
  initialValues,
  onCancel,
  onDelete,
  isDeleting = false,
}) => {
  const isEdit = mode === 'edit';
  const initialCategory = useMemo(() => entryCategoryFromInitialValues(initialValues), [initialValues]);

  const [selectedLocationId, setSelectedLocationId] = useState(initialValues?.locationId ?? '');
  const [category, setCategory] = useState<EntryCategory>(initialCategory ?? DEFAULT_ENTRY_CATEGORY);
  const [targetMonth, setTargetMonth] = useState(() => initialValues?.targetMonth ?? getCurrentYearMonth());
  const [amount, setAmount] = useState(initialValues?.amount ?? '');
  const [note, setNote] = useState(initialValues?.note ?? '');
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 削除は誤操作防止のため2段階（1回目で確認表示、2回目で実行）。ダイアログは使わない。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 選択肢に無い id（稼働中・一時停止でなくなった拠点の記録を編集中）は採用せず先頭拠点へ倒す。
  // ネイティブ select は一致する option が無いと先頭を表示するため、表示・係数判定・保存内容を一致させる。
  const effectiveSelectedLocationId = locations.some((location) => location.id === selectedLocationId)
    ? selectedLocationId
    : (locations[0]?.id ?? '');
  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === effectiveSelectedLocationId),
    [locations, effectiveSelectedLocationId],
  );
  // 編集対象の拠点が稼働中・一時停止でなくなり選択肢に無い場合は、黙って別の拠点へ付け替えて保存しないよう
  // 案内を出して保存を止める（削除は可能）。拠点セレクトも触れないようにする。
  const initialLocationMissing =
    isEdit && initialValues !== undefined && !locations.some((location) => location.id === initialValues.locationId);

  const maxTargetMonth = getCurrentYearMonth();
  // この修正より前に登録された未来月レコードを編集する場合、対象年月を変えなければ
  // 他の項目（活動量・備考など）だけを直して保存できるようにする。
  const allowedFutureMonth = isEdit ? (initialValues?.targetMonth ?? null) : null;
  // period は検証に通ったときだけ入る（エラー時は null）。以降のガードは period だけ見れば足りる。
  const { period, error: targetMonthError } = useMemo(
    () => validateTargetMonth(targetMonth, maxTargetMonth, { allowedFutureMonth }),
    [targetMonth, maxTargetMonth, allowedFutureMonth],
  );

  const path = entryPathOf(category);
  const factorSource = factorSourceOf(category);
  const isIdea = factorSource === 'idea';

  // 会計年度マスタ。isLoading 単体でゲートしない（認証イベントのたびに true へ戻る）。
  // 「未確定」= 初回ロード中のみ。失敗・年度未登録では true になりフォールバック導出に落ちる。
  const { fiscalYears, isLoading: isLoadingFiscalYears, setFiscalYearId } = useFiscalYear();
  const fiscalYearsReady = !isLoadingFiscalYears || fiscalYears.length > 0;
  // 係数解決コンテキストの適用年度。算定バッチと同様に会計年度マスタの開始年を正とする（無ければ4月始まりで導出）。
  // 係数の取得対象年度（開始年＋対象月の温対法年度）はこの値から useScope12FactorSelection が組み立てる。
  // IDEA 係数は年度非依存だが、算定バッチと同じ導出を通して整合させる。
  const applicableYear = useMemo(
    () => (period ? applicableYearForDate(fiscalYears, period.start) : null),
    [fiscalYears, period],
  );
  // Scope1/2 は年度が係数取得キーになるため、会計年度マスタ確定前は取得しない（誤年度の取得・保存を防ぐ）。
  const factorYear = fiscalYearsReady ? applicableYear : null;

  // 両フックは常に呼ぶ（フックの呼び出し順を固定）。enabled で取得・判定を止める。
  const scope12 = useScope12FactorSelection({
    enabled: !isIdea,
    energyType: category.kind === 'energy' ? category.energyType : null,
    location: selectedLocation,
    period,
    applicableYear: factorYear,
    isEdit,
    initialFactorId: isEdit && initialValues?.kind === 'scope12' ? initialValues.emissionFactorId : null,
  });
  const idea = useIdeaProductSelection({
    enabled: isIdea,
    isEdit,
    initialIdeaFactorId: isEdit && initialValues?.kind === 'scope3' ? initialValues.ideaFactorId : null,
  });

  const appliedFactor = scope12.applied.status === 'resolved' ? scope12.applied.factor : null;
  const unitInfo = resolveEntryUnit({
    category,
    mode,
    initial:
      isEdit && initialValues?.kind === 'scope12'
        ? { energyType: initialValues.energyType, unit: initialValues.unit }
        : null,
    productUnit: idea.productDetail?.unit ?? null,
    // 標準単位で換算できない係数（通勤に t-CO2e/km のカスタム係数、出張に kg-CO2/円 の公式係数を当てた場合など）は係数の分母単位で入力させる。
    factorUnit: appliedFactor?.unit ?? null,
  });
  const currentUnit = unitInfo.unit;
  const isNonStandardUnit = unitInfo.kind === 'energy' && unitInfo.isNonStandard;
  const isFactorDerivedUnit = unitInfo.kind === 'energy' && unitInfo.isFactorDerived;
  // 標準単位で入力するときだけ数え方の補足を出す（記録の単位・係数の分母単位を採るときは当てはまらない）。
  const amountGuide =
    category.kind === 'energy' && !isNonStandardUnit && !isFactorDerivedUnit
      ? (MANUAL_ACTIVITY_CATEGORY_MAP[category.energyType].amountGuide ?? null)
      : null;

  // この入力が Scope 3 の積上げ（calculated）側に載るカテゴリと、そのカテゴリの現在の算定方法。
  // 方式が direct のままだと算定は成功してもダッシュボードの Scope 3 合計に採用されないため、
  // 入力の時点で注記と Scope分析画面への導線を出す。
  // 年度は「対象年月が属する会計年度」で引く（画面上部で選択中の年度ではなく、この記録の帰属先）。
  const scope3CategoryId = scope3AdoptedCategoryId({
    category,
    appliedFactorScope: appliedFactor?.scope ?? null,
  });
  const recordFiscalYear = useMemo(
    () => (period ? findFiscalYearForDate(fiscalYears, period.start) : null),
    [fiscalYears, period],
  );
  const recordFiscalYearId = recordFiscalYear?.id ?? null;
  const scope3MethodLoader = useKeyedLoader(
    recordFiscalYearId !== null && scope3CategoryId !== null
      ? scope3MethodKey(recordFiscalYearId, scope3CategoryId)
      : null,
    getScope3CategoryMethod,
    'Scope 3 の算定方法の取得に失敗しました',
  );
  // 取得できなかった場合は注記を出さない（誤った「反映されません」を出すより黙る）。
  const scope3DirectNotice = scope3DirectMethodNoticeText({
    categoryId: scope3CategoryId,
    method: scope3MethodLoader.state?.status === 'ready' ? scope3MethodLoader.state.value : null,
    fiscalYearLabel: recordFiscalYear?.label ?? null,
  });

  const amountValidation = validateAmount(amount);
  const validAmount = amountValidation.kind === 'valid' ? amountValidation.value : null;
  // numeric(15,3) に収まらない桁数は入力欄の直下で即座に知らせる（計算結果が出ない理由を分かるようにする）。
  // 空・0 は入力途中の状態なので、プレビュー / 保存時の検証（validateEntry）に任せる。
  const amountDigitsError =
    amountValidation.kind === 'too-large' || amountValidation.kind === 'too-precise'
      ? amountValidationMessage(amountValidation)
      : null;
  // 推定排出量（t-CO2e）。算定エンジンと同じ単位換算・丸め（第6位）で計算する。null = 単位不一致。
  // Scope1/2 は「保存後に実際に適用される係数」を基準にし、プレビューと算定結果を一致させる。
  const estimatedEmissions: number | null =
    validAmount === null || currentUnit === null
      ? null
      : isIdea
        ? idea.productDetail && applicableYear !== null
          ? computeEstimatedScope3Emissions(validAmount, idea.productDetail, applicableYear)
          : null
        : appliedFactor
          ? computeEstimatedEmissions(validAmount, currentUnit, appliedFactor)
          : null;

  const calculationView = buildCalculationResultView({
    factorSource,
    hasPeriod: period !== null,
    amount: validAmount,
    unit: currentUnit,
    factorsReady: isIdea || (scope12.isFactorsReady && scope12.applied.status === 'resolved'),
    appliedFactor,
    factorAmbiguous: scope12.applied.status === 'resolved' && scope12.applied.ambiguous,
    productDetail: idea.productDetail,
    estimatedEmissions,
  });

  const categoryGroups = useMemo(
    () => buildEntryCategoryGroups({ mode, initialCategory }),
    [mode, initialCategory],
  );

  // 編集で保存されている係数の復元（事業者リストからの派生）が確定するまで、対象年月・拠点の変更を止める
  // （年度をまたぐ変更で復元が飛び、代替値で保存されるのを防ぐ）。
  const isConditionLocked = initialLocationMissing || (!isIdea && scope12.isRestorePending);

  // 係数（または製品）が未確定のまま保存されないよう、取得中はプレビューを開けない
  // （E2E は Playwright の enabled 自動待機で互換）。
  const isFactorLoading = isIdea
    ? idea.isLoadingDetail
    : period !== null && (!fiscalYearsReady || scope12.isLoadingFactors || scope12.applied.status === 'pending');
  const isPreviewBlocked =
    locations.length === 0 || initialLocationMissing || isSaving || isDeleting || isFactorLoading;

  const handleCategoryChange = (value: string) => {
    const next = parseEntryCategoryValue(value);
    // 編集では保存経路（Scope1/2 ⇄ Scope3）をまたぐ変更を受け付けない（サービスに更新経路が無い）。
    if (!next || (isEdit && initialCategory && entryPathOf(next) !== entryPathOf(initialCategory))) {
      return;
    }
    setCategory(next);
    scope12.onConditionChanged('category');
  };

  const validate = (): string | null =>
    validateEntry(
      {
        locationId: effectiveSelectedLocationId,
        targetMonthError,
        amount,
        note,
        factor: isIdea
          ? {
              source: 'idea',
              productSelected: idea.selectedProductId !== null,
              productReady: idea.productDetail !== null,
              isFactorMissing: idea.isFactorMissing,
              detailError: idea.detailError,
            }
          : { source: factorSource },
      },
      { factorMissing: SCOPE3_FACTOR_MISSING_MESSAGE },
    );

  // モーダルの Escape リスナーが毎レンダー付け直されないよう、閉じる操作は参照を固定する。
  const closePreview = useCallback(() => setShowPreview(false), []);

  const handlePreviewClick = () => {
    const error = validate();
    if (error) {
      setErrorMessage(error);
      setShowPreview(false);
      return;
    }
    setErrorMessage(null);
    setShowPreview(true);
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      setErrorMessage(error);
      setShowPreview(false);
      return;
    }
    const entry =
      period && validAmount !== null && currentUnit !== null
        ? buildActivityEntryInput({
            category,
            locationId: effectiveSelectedLocationId,
            period,
            amount: validAmount,
            // Scope1/2 は編集でカテゴリ未変更なら記録の単位（'MWh' 等）をそのまま保存する。
            // Scope3 は選択製品の単位（自動設定・編集不可。算定時の単位換算は常に 1:1）。
            unit: currentUnit,
            note,
            // 選択中の係数を保存し、算定バッチで確実にこの係数が使われるようにする。
            // 候補が無い場合は null（従来どおり算定時に自動解決＝未解決なら未算定）。
            emissionFactorId: scope12.factorIdToSave,
            ideaFactorId: idea.productDetail?.id ?? null,
          })
        : null;
    if (!entry) {
      setErrorMessage(VALIDATION_MESSAGES.inconsistent);
      setShowPreview(false);
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await onSave(entry);
      setShowPreview(false);
      if (isEdit) {
        // 編集はモーダルを閉じる（親が一覧を再取得する）。
        onCancel?.();
      } else {
        // 続けて別の月・別製品を入力しやすいよう、拠点・カテゴリ・年月・係数/製品の選択は保持する。
        setAmount('');
        setNote('');
      }
    } catch (error) {
      // エラーはカード内のバナーに出す。プレビューモーダル（全面スクリム）を開いたままだと隠れて見えないため閉じる。
      setShowPreview(false);
      setErrorMessage(error instanceof Error ? error.message : SAVE_FAILURE_MESSAGES[path][mode]);
    } finally {
      setIsSaving(false);
    }
  };

  const previewRows =
    showPreview && period && validAmount !== null && currentUnit !== null
      ? buildPreviewRows({
          category,
          factorSource,
          locationName: selectedLocation?.name ?? null,
          period,
          amount: validAmount,
          unit: currentUnit,
          isNonStandardUnit,
          note,
          factorSourceText: factorSourceRowText({
            factorSource,
            isProviderFactorSelected: scope12.providerFactor !== null,
            // 「候補から変更」は保存後に適用される係数が候補先頭（自動選択）でないことで判定する
            isCandidateOverridden:
              scope12.providerFactor === null &&
              appliedFactor !== null &&
              scope12.factorCandidates[0]?.id !== appliedFactor.id,
            isSavedFactorKeptUnknown: scope12.applied.status === 'unknown' && scope12.applied.reason === 'provider',
          }),
          appliedFactor,
          willFallBackFromSavedFactor:
            scope12.applied.status === 'resolved' && scope12.applied.fellBack && !scope12.applied.remapped,
          savedFactorRemapped: scope12.applied.status === 'resolved' && scope12.applied.remapped,
          savedFactorKept: isEdit && !scope12.factorTouched,
          appliedFactorUnknown: scope12.applied.status === 'unknown' ? scope12.applied.reason : null,
          productDetail: idea.productDetail,
          estimatedEmissions,
        })
      : null;
  const previewCaution =
    !isIdea && isEdit && !scope12.factorTouched && scope12.applied.status === 'resolved' && scope12.applied.fellBack
      ? scope12.applied.remapped
        ? '保存されていた係数は年度更新で入れ替わったため、同じ供給事業者・メニューの上記の係数で再計算されます。'
        : '保存されていた係数は現在の条件では適用できないため、上記の自動選択された係数で再計算されます。'
      : null;

  return (
    <>
      <Card className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-primary" />
            <h2 className="text-lg font-serif font-semibold text-text-heading">
              {isEdit ? '活動量の編集' : 'データ入力フォーム'}
            </h2>
          </div>
          {!isEdit && (
            <p className="text-xs text-text-muted">
              Scope 1・2・3 の活動量を同じ手順で登録します。カテゴリに応じて排出係数の参照方式（供給事業者別・標準・IDEA）を自動で切り替えます。
            </p>
          )}
        </div>

        {locations.length === 0 && (
          <EntryNotice variant="warning">
            データ入力に使用できる拠点がありません。稼働中または一時停止の拠点を登録してください。
          </EntryNotice>
        )}
        {initialLocationMissing && initialValues && (
          <EntryNotice variant="warning">
            この記録の拠点「{initialValues.locationName}」は稼働中・一時停止ではないため、この記録は編集できません（削除は可能です）。拠点管理で状態を変更してから編集してください。
          </EntryNotice>
        )}

        <EntrySection
          step={1}
          title="基本情報"
          titleId="manual-step-1"
          hint={isEdit ? `登録済みの記録は「${ENTRY_PATH_LABELS[path]}」の中でのみカテゴリを変更できます` : undefined}
        >
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
            <EntryField htmlFor="manual-category-select" label="カテゴリ" className="md:col-span-2">
              <select
                id="manual-category-select"
                value={formatEntryCategoryValue(category)}
                onChange={(event) => handleCategoryChange(event.target.value)}
                className="gt-field"
              >
                {categoryGroups.map((group) => (
                  <optgroup key={group.id} label={group.label} disabled={group.disabled}>
                    {group.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {/* カテゴリから判定した参照方式をその場で見せる（閉じた select は optgroup の見出しを見せないため）。 */}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span>排出係数の参照方式:</span>
                <FactorSourceChip factorSource={factorSource} />
              </div>
              {/* 算定方法が direct のカテゴリは、入力してもダッシュボードの Scope 3 合計に採用されない。 */}
              {scope3DirectNotice && (
                <div className="mt-2" data-testid="manual-scope3-method-notice">
                  <EntryNotice variant="warning">
                    {scope3DirectNotice}
                    {/* Scope分析は選択年度のカテゴリを操作するため、この記録の帰属年度で開かないと
                        別年度のカテゴリを切替えてしまう。選択年度はタブ内の state で永続化されないので、
                        新しいタブで開いても年度が届くよう URL で運び、同一タブの即応性のために
                        クリック時にも選択年度を合わせる。 */}
                    <Link
                      href={scopeAnalysisHref(recordFiscalYearId)}
                      onClick={() => {
                        if (recordFiscalYearId) setFiscalYearId(recordFiscalYearId);
                      }}
                      className="ml-1 font-semibold underline"
                    >
                      {recordFiscalYear ? `${recordFiscalYear.label}の Scope分析画面を開く` : 'Scope分析画面を開く'}
                    </Link>
                  </EntryNotice>
                </div>
              )}
            </EntryField>

            <EntryField htmlFor="manual-location-select" label="拠点">
              <select
                id="manual-location-select"
                value={effectiveSelectedLocationId}
                onChange={(event) => {
                  setSelectedLocationId(event.target.value);
                  // 入力条件が変わったら係数の上書き選択は解除し、自動選択へ戻す。
                  scope12.onConditionChanged('location');
                }}
                disabled={isConditionLocked}
                className="gt-field"
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </EntryField>

            <EntryField htmlFor="manual-target-month" label="対象年月" error={targetMonthError}>
              <input
                id="manual-target-month"
                type="month"
                value={targetMonth}
                min={MIN_TARGET_MONTH}
                max={maxTargetMonth}
                onChange={(event) => {
                  setTargetMonth(event.target.value);
                  scope12.onConditionChanged('targetMonth');
                }}
                disabled={isConditionLocked}
                className="gt-field"
                aria-invalid={targetMonthError !== null}
                aria-describedby={targetMonthError ? 'manual-target-month-error' : undefined}
              />
            </EntryField>
          </div>
        </EntrySection>

        {locations.length > 0 && (
          <EntrySection step={2} title="排出係数の参照" titleId="manual-step-2">
            <ActivityEntryFactorSection
              factorSource={factorSource}
              hasPeriod={period !== null}
              fiscalYearsReady={fiscalYearsReady}
              isEdit={isEdit}
              scope12={scope12}
              idea={idea}
            />
          </EntrySection>
        )}

        {locations.length > 0 && (
          <EntrySection step={3} title="活動量と計算結果" titleId="manual-step-3">
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-2">
              <EntryField
                htmlFor="manual-amount-input"
                label={amountFieldLabel(currentUnit)}
                hint={
                  isIdea
                    ? '(単位は選択した製品から自動設定・変更不可)'
                    : isNonStandardUnit
                      ? '(記録の単位をそのまま使用)'
                      : isFactorDerivedUnit
                        ? '(単位は適用する係数から自動設定)'
                        : '(単位はカテゴリから自動設定)'
                }
              >
                <div className="flex items-center gap-2">
                  <input
                    id="manual-amount-input"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.000"
                    value={amount}
                    onChange={(event) => {
                      if (DECIMAL_PATTERN.test(event.target.value)) {
                        setAmount(event.target.value);
                      }
                    }}
                    aria-describedby="manual-unit-display"
                    className="gt-field"
                  />
                  <UnitBadge unit={currentUnit} />
                </div>
                {amountDigitsError && (
                  <p className="mt-1.5 text-sm text-danger" data-testid="manual-amount-error">
                    {amountDigitsError}
                  </p>
                )}
                {amountGuide && (
                  <p className="mt-1.5 text-xs text-text-muted">
                    {amountGuide}
                  </p>
                )}
                {isNonStandardUnit && unitInfo.kind === 'energy' && (
                  <p className="mt-1.5 text-sm text-warning">
                    この記録の単位「{unitInfo.unit}」はカテゴリ「{entryCategoryLabel(category)}
                    」の標準単位「{unitInfo.standardUnit}」と異なります（取込データ）。単位は変更せずそのまま保存します。
                  </p>
                )}
              </EntryField>
            </div>
            <EntryCalculationResult view={calculationView} />
          </EntrySection>
        )}

        {locations.length > 0 && (
          <EntrySection step={4} title="備考" titleId="manual-step-4" hint={`(任意・${NOTE_MAX_LENGTH}文字以内)`}>
            <div>
              {/* 見出しが視覚上のラベルを兼ねるため、入力欄には不可視のラベルで名前と補足を紐づける。 */}
              <label htmlFor="manual-note-input" className="sr-only">
                備考（任意・{NOTE_MAX_LENGTH}文字以内）
              </label>
              <textarea
                id="manual-note-input"
                aria-describedby="manual-note-counter"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={isIdea ? '例：4月分の購買実績（月次合算）' : '例：4月分電気代明細より転記'}
                rows={2}
                className="gt-field h-auto min-h-12 resize-y py-2"
              />
              <div id="manual-note-counter" className="mt-1 text-right text-xs text-text-muted">
                {note.length} / {NOTE_MAX_LENGTH}
              </div>
            </div>
          </EntrySection>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-sm border border-danger bg-danger-light px-4 py-3 text-sm text-danger"
          >
            <X size={16} className="shrink-0" />
            {errorMessage}
          </div>
        )}

        <div
          className={`flex flex-wrap items-center gap-2 border-t border-border-light pt-5 ${
            isEdit ? 'justify-between' : 'justify-end'
          }`}
        >
          {isEdit && onDelete && (
            <button
              type="button"
              onClick={() => {
                if (confirmingDelete) {
                  onDelete();
                } else {
                  setConfirmingDelete(true);
                }
              }}
              disabled={isSaving || isDeleting}
              // .btn-outline は層外 CSS で border / color を固定するため使わず、.btn に危険色を直接足す。
              className="gt-btn border-danger text-danger hover:bg-danger-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={16} className="mr-1" />
              {isDeleting ? '削除中...' : confirmingDelete ? 'もう一度押すと削除します' : 'この履歴を削除'}
            </button>
          )}
          <div className="flex gap-2">
            {isEdit && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isSaving || isDeleting}
                className="gt-btn min-w-28 disabled:cursor-not-allowed disabled:opacity-50"
              >
                キャンセル
              </button>
            )}
            <button
              id="manual-preview-button"
              type="button"
              onClick={handlePreviewClick}
              disabled={isPreviewBlocked}
              className="gt-btn-primary min-w-36 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isEdit ? '変更内容を確認' : '入力プレビュー'}
            </button>
          </div>
        </div>
      </Card>

      {previewRows && (
        <ActivityEntryPreviewModal
          mode={mode}
          rows={previewRows}
          caution={previewCaution}
          isSaving={isSaving}
          onClose={closePreview}
          onSave={handleSave}
        />
      )}
    </>
  );
};
