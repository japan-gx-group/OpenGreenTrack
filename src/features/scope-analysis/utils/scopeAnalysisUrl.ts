/**
 * Scope分析画面の URL。
 *
 * 選択年度はタブ内の React state で保持され永続化されないため、他画面からの導線で
 * 「この年度の Scope分析を開く」を約束するには、年度をクリック時の state 更新ではなく
 * URL で運ぶ必要がある（cmd+クリック・中クリックで新しいタブに開かれると state は届かない）。
 */
export const SCOPE_ANALYSIS_PATH = '/scope-analysis';

/** 開いたときに選択年度へ適用する会計年度IDを運ぶクエリパラメータ名 */
export const SCOPE_ANALYSIS_FISCAL_YEAR_PARAM = 'fy';

/** 会計年度を指定して Scope分析画面を開く href。年度が特定できないときは素の URL */
export const scopeAnalysisHref = (fiscalYearId: string | null): string =>
  fiscalYearId
    ? `${SCOPE_ANALYSIS_PATH}?${SCOPE_ANALYSIS_FISCAL_YEAR_PARAM}=${encodeURIComponent(fiscalYearId)}`
    : SCOPE_ANALYSIS_PATH;
