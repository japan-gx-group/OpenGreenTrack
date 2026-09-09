'use client';

// 統合データ入力フォームの Scope3 積上げ（IDEA 連携）の製品選択。
// IDEA 取込状況の確認 → 製品のインクリメンタル検索（searchIdeaProducts + SearchableSelect の
// サーバーサイド検索・debounce）→ 選択製品の詳細（係数値込み）取得 をまとめ、参照切れの判定も担う。
// Scope3 カテゴリを選んでいる間だけ動く（enabled）。取得は hooks/useKeyedLoader.ts に委ねる。

import { useEffect, useMemo, useState } from 'react';
import type { SearchableSelectOption } from '@/components/ui/searchableSelectFilter';
import { fetchIdeaImportOverview } from '@/features/factors/services/ideaImportClient';
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

// IDEA 取込状況の確認（Scope3 を選んだマウント中に 1 回）。active な取込が無ければ製品を検索できない。
const loadHasActiveImport = () => fetchIdeaImportOverview().then((overview) => overview.active !== null);
// 選択製品の詳細（係数値込み）を取得する。編集の初期表示でも同じ経路で取得する。
// 参照切れ（詳細が引けない = null）は編集時の孤児と同じ扱いで再選択を促す。
const loadIdeaProductDetail = (id: string) => getIdeaProductDetail(id);

export interface UseIdeaProductSelectionArgs {
  /** factorSource === 'idea' のとき true。false なら取込状況の確認・検索・詳細取得を一切行わない。 */
  enabled: boolean;
  isEdit: boolean;
  /** 編集で開いた Scope3 レコードの ideaFactorId（孤児は null）。Scope1/2 レコード・新規は null。 */
  initialIdeaFactorId: string | null;
}

export interface IdeaProductSelectionView {
  /** null = 確認中。false のとき検索を無効化し案内を出す。取得失敗時は true（検索自体は試せるようにする） */
  hasActiveImport: boolean | null;
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
  const overview = useKeyedLoader(args.enabled ? IDEA_OVERVIEW_KEY : null, loadHasActiveImport, '');
  // 取得失敗時は true にして検索を試せるようにする（検索側のエラー表示に任せる）。
  const hasActiveImport: boolean | null =
    overview.state === undefined ? null : overview.state.status === 'ready' ? overview.state.value : true;

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
    if (!args.enabled || hasActiveImport === false) {
      return;
    }
    let isStale = false;
    const timer = setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      searchIdeaProducts(searchQuery)
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
  }, [args.enabled, searchQuery, hasActiveImport]);

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

  return {
    hasActiveImport,
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
