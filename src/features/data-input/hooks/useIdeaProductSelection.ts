'use client';

// 統合データ入力フォームの Scope3 積上げ（IDEA 連携）の製品選択。
// IDEA 取込状況の確認 → 製品のインクリメンタル検索（searchIdeaProducts + SearchableSelect の
// サーバーサイド検索・debounce）→ 選択製品の詳細（係数値込み）取得 をまとめ、参照切れの判定も担う。
// 検索する版は、活動量の期間が属する会計年度に割り当てた版（無ければ有効な版）。選択中の製品が
// その版の製品でないとき（対象年月を別の年度へ変えた・版の割り当て前に算定した記録を編集した等）は選び直しを促す。
// Scope3 カテゴリを選んでいる間だけ動く（enabled）。取得は hooks/useKeyedLoader.ts に委ねる。

import { useEffect, useMemo, useState } from 'react';
import type { SearchableSelectOption } from '@/components/ui/searchableSelectFilter';
import {
  fetchIdeaImportForFiscalYear,
  fetchIdeaImportOverview,
} from '@/features/factors/services/ideaImportClient';
import {
  getIdeaProductDetail,
  searchIdeaProducts,
  type IdeaProduct,
  type IdeaProductDetail,
} from '@/features/factors/services/ideaProductSearch';
import { buildIdeaSelectOptions } from '../services/entryFormat';
import { useKeyedLoader } from './useKeyedLoader';

/** 製品検索の debounce 間隔（ms）。SearchableSelect の入力に対するサーバー検索を間引く。 */
export const SEARCH_DEBOUNCE_MS = 300;
export const IDEA_SEARCH_ERROR_MESSAGE = 'IDEA製品の検索に失敗しました。時間をおいて再度お試しください。';
export const IDEA_DETAIL_ERROR_MESSAGE = 'IDEA製品情報の取得に失敗しました。時間をおいて再度お試しください。';

const IDEA_OVERVIEW_KEY = 'overview';
export const IDEA_FISCAL_YEAR_IMPORT_ERROR_MESSAGE =
  'この年度に割り当てた IDEA の版を確認できませんでした。有効な版から検索します。';

/** 検索の対象にする版（id と版の表記） */
interface IdeaImportVersion {
  id: string;
  version: string;
}

// IDEA 取込状況の確認（Scope3 を選んだマウント中に 1 回）。active な取込も年度の割り当ても無ければ製品を検索できない。
const loadActiveImport = (): Promise<IdeaImportVersion | null> =>
  fetchIdeaImportOverview().then((overview) =>
    overview.active ? { id: overview.active.id, version: overview.active.version } : null,
  );
// 会計年度に割り当てた版（割り当てが無ければ null = 有効な版を使う）。
const loadFiscalYearImport = (fiscalYearId: string): Promise<IdeaImportVersion | null> =>
  fetchIdeaImportForFiscalYear(fiscalYearId).then((assigned) =>
    assigned ? { id: assigned.importId, version: assigned.version } : null,
  );
// 選択製品の詳細（係数値込み）を取得する。編集の初期表示でも同じ経路で取得する。
// 参照切れ（詳細が引けない = null）は編集時の孤児と同じ扱いで再選択を促す。
const loadIdeaProductDetail = (id: string) => getIdeaProductDetail(id);

export interface UseIdeaProductSelectionArgs {
  /** factorSource === 'idea' のとき true。false なら取込状況の確認・検索・詳細取得を一切行わない。 */
  enabled: boolean;
  isEdit: boolean;
  /** 編集で開いた Scope3 レコードの ideaFactorId（孤児は null）。Scope1/2 レコード・新規は null。 */
  initialIdeaFactorId: string | null;
  /** 対象年月が属する会計年度（未登録・未確定は null。その場合は有効な版から検索する） */
  fiscalYearId: string | null;
}

export interface IdeaProductSelectionView {
  /**
   * 検索できる版（年度に割り当てた版か、有効な版）があるか。null = 確認中。
   * false のとき検索を無効化し案内を出す。取得失敗時は true（検索自体は試せるようにする）
   */
  hasActiveImport: boolean | null;
  /** 検索対象の版の説明（例: 'Ver.4.0（2024年度に割り当てた版）'）。確認中・版が無いときは null */
  searchVersionLabel: string | null;
  /** 選択中の製品が検索対象の版の製品でないときの案内（選び直しを促す）。該当しなければ null */
  versionNotice: string | null;
  /** 年度に割り当てた版を確認できなかったときの案内（有効な版で検索を続ける） */
  fiscalYearImportError: string | null;
  selectOptions: SearchableSelectOption[];
  isSearching: boolean;
  searchError: string | null;
  setSearchQuery: (query: string) => void;
  selectedProductId: string | null;
  selectProduct: (productId: string | null) => void;
  productDetail: IdeaProductDetail | null;
  isLoadingDetail: boolean;
  detailError: string | null;
  /** 製品詳細の取得失敗を破棄して再取得する */
  retryDetail: () => void;
  /** 編集で参照切れ（ideaFactorId=null / 参照先削除）のときに再選択を促す表示 */
  isFactorMissing: boolean;
}

export const useIdeaProductSelection = (args: UseIdeaProductSelectionArgs): IdeaProductSelectionView => {
  const overview = useKeyedLoader(args.enabled ? IDEA_OVERVIEW_KEY : null, loadActiveImport, '');
  const fiscalYearImport = useKeyedLoader(
    args.enabled ? args.fiscalYearId : null,
    loadFiscalYearImport,
    IDEA_FISCAL_YEAR_IMPORT_ERROR_MESSAGE,
  );
  const activeImport = overview.state?.status === 'ready' ? overview.state.value : null;
  // 年度に割り当てた版。年度が無い・確認できなかったときは null（有効な版を使う）。
  const assignedImport = fiscalYearImport.state?.status === 'ready' ? fiscalYearImport.state.value : null;
  // 年度の割り当てを確認し終えたか（年度が無ければ確認不要）。確認前に有効な版で検索して候補が入れ替わらないようにする。
  const fiscalYearImportSettled = args.fiscalYearId === null || fiscalYearImport.state !== undefined;
  const searchImport: IdeaImportVersion | null = assignedImport ?? activeImport;
  // 取得失敗時は true にして検索を試せるようにする（検索側のエラー表示に任せる）。
  const hasActiveImport: boolean | null =
    assignedImport !== null
      ? true
      : overview.state === undefined || !fiscalYearImportSettled
        ? null
        : overview.state.status === 'ready'
          ? overview.state.value !== null
          : true;
  const searchImportId = assignedImport?.id ?? null;

  // 製品検索の状態。キーワードは SearchableSelect から受け取り、debounce してサーバー検索する。
  const [searchQuery, setSearchQuery] = useState('');
  const [productOptions, setProductOptions] = useState<IdeaProduct[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // 選択中の製品。id は SearchableSelect の value、detail は概算・保存に使う係数値込みの詳細。
  const [selectedProductId, setSelectedProductId] = useState<string | null>(args.initialIdeaFactorId);
  // 製品を選び直したか。編集で開いた孤児レコードの「再選択が必要」表示を消す判定に使う（復元・取得からは触らない）。
  const [productTouched, setProductTouched] = useState(false);

  // 製品のインクリメンタル検索（サーバーサイド ilike・上限50件・debounce）。
  // setState は setTimeout コールバック内なので react-hooks/set-state-in-effect には当たらない。
  // isStale は「古い検索結果で新しい候補を上書きしない」ための順序制御。
  useEffect(() => {
    if (!args.enabled || hasActiveImport === false || !fiscalYearImportSettled) {
      return;
    }
    let isStale = false;
    const timer = setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      // 年度に割り当てた版があればその版、無ければ有効な版（importId = null）から検索する
      searchIdeaProducts(searchQuery, { importId: searchImportId })
        .then((products) => {
          if (isStale) return;
          setProductOptions(products);
          setIsSearching(false);
        })
        .catch(() => {
          if (isStale) return;
          setSearchError(IDEA_SEARCH_ERROR_MESSAGE);
          setIsSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      isStale = true;
      clearTimeout(timer);
    };
  }, [args.enabled, searchQuery, hasActiveImport, fiscalYearImportSettled, searchImportId]);

  const detail = useKeyedLoader(
    args.enabled ? selectedProductId : null,
    loadIdeaProductDetail,
    IDEA_DETAIL_ERROR_MESSAGE,
  );
  const productDetail = detail.state?.status === 'ready' ? detail.state.value : null;
  const detailError = detail.state?.status === 'error' ? detail.state.message : null;
  // 参照切れ: 編集で開いた孤児レコード（ideaFactorId=null）を未再選択のまま、または参照先が削除されて詳細が引けない。
  const isFactorMissing =
    args.enabled &&
    ((args.isEdit && args.initialIdeaFactorId === null && !productTouched) ||
      (detail.state?.status === 'ready' && detail.state.value === null));

  const selectOptions = useMemo(
    () => buildIdeaSelectOptions(productOptions, productDetail, selectedProductId),
    [productOptions, productDetail, selectedProductId],
  );

  const searchVersionLabel =
    searchImport === null
      ? null
      : assignedImport !== null
        ? `${searchImport.version}（この年度に割り当てた版）`
        : `${searchImport.version}（有効な版）`;
  // 選択中の製品が検索対象の版の製品でない（別の年度の版・版の割り当て前の製品）。算定はその製品の版で行われるため、
  // 年度の版で算定したいときは選び直す必要がある。
  const versionNotice =
    args.enabled && productDetail !== null && searchImport !== null && productDetail.importId !== searchImport.id
      ? `選択中の製品は ${productDetail.importVersion ?? '別の版'} の係数です。この年度は ${searchVersionLabel} で算定する設定のため、製品を選び直してください（選び直さない場合は ${productDetail.importVersion ?? '選択中の版'} の係数で算定されます）。`
      : null;
  const fiscalYearImportError =
    fiscalYearImport.state?.status === 'error' ? fiscalYearImport.state.message : null;

  return {
    hasActiveImport,
    searchVersionLabel,
    versionNotice,
    fiscalYearImportError,
    selectOptions,
    isSearching,
    searchError,
    setSearchQuery,
    selectedProductId,
    selectProduct: (productId) => {
      setSelectedProductId(productId);
      setProductTouched(true);
    },
    productDetail,
    isLoadingDetail: detail.isLoading,
    detailError,
    retryDetail: detail.retry,
    isFactorMissing,
  };
};
