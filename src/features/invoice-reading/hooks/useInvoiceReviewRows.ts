'use client';

// 一括登録の表の状態。読み取りの結果から行を作り（services/reviewRows.ts）、利用者が直した値・登録するかの選択を重ね、
// 行ごとの排出係数を非同期で解決する（services/rowFactorResolution.ts。係数マスタは表の全行で共有して 1 回だけ読む）。
// 解決の結果は「その時点の条件（拠点・対象年月・係数の選択）」と一緒に覚え、条件が変わった行だけ解決し直す。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEntryInput, ManualEntryLocationOption, SavedManualActivityRecord } from '@/features/data-input/types';
import type { FiscalYearRange } from '@/features/data-input/services/inlineCalculation';
import { getCurrentYearMonth, toPeriodDates } from '@/features/data-input/services/manualEntryTargetMonth';
import type { InvoiceReadingResult } from '../types';
import {
  buildReviewRowSources,
  buildRowEntry,
  buildRowPrefill,
  checkReviewRow,
  initialRowValues,
  listUnregistrableItems,
  type ReviewRowCheck,
  type ReviewRowSource,
  type ReviewRowValues,
} from '../services/reviewRows';
import { createFactorCatalog, resolveRowFactor, type FactorCatalog, type RowFactorView } from '../services/rowFactorResolution';

export interface ReviewRow {
  source: ReviewRowSource;
  values: ReviewRowValues;
  /** 解決済みの排出係数。解決中・拠点か対象年月が決まらないときは null */
  view: RowFactorView | null;
  check: ReviewRowCheck;
  /** 登録できる（必須項目がそろい、係数を解決できた） */
  canInclude: boolean;
  /** 登録する（チェック）。既定は、登録できて確かめることが無い行だけ */
  include: boolean;
  /** 登録に失敗したときの理由 */
  saveError: string | null;
  /** 係数の解決に失敗したときの理由 */
  factorError: string | null;
}

interface ResolvedView {
  signature: string;
  view: RowFactorView | null;
  error: string | null;
}

export const useInvoiceReviewRows = (args: {
  results: readonly InvoiceReadingResult[];
  locations: readonly ManualEntryLocationOption[];
  historyRecords: readonly SavedManualActivityRecord[];
  fiscalYears: readonly FiscalYearRange[];
  /** テストで係数マスタの取得を差し替える */
  catalog?: FactorCatalog;
}) => {
  const sources = useMemo(() => buildReviewRowSources(args.results), [args.results]);
  const unregistrable = useMemo(() => listUnregistrableItems(args.results), [args.results]);
  const [overrides, setOverrides] = useState<Record<string, Partial<ReviewRowValues>>>({});
  const [includeOverrides, setIncludeOverrides] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [views, setViews] = useState<Record<string, ResolvedView>>({});

  const catalogRef = useRef<FactorCatalog | null>(args.catalog ?? null);
  const pendingRef = useRef(new Map<string, string>());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fiscalYearsKey = args.fiscalYears.map((year) => `${year.id}:${year.startDate}:${year.endDate}`).join('|');
  const base = useMemo(
    () =>
      sources
        .filter((source) => !savedKeys.has(source.key))
        .map((source) => ({ source, values: { ...initialRowValues(source), ...overrides[source.key] } })),
    [sources, savedKeys, overrides],
  );

  // 解決が要る行（拠点と対象年月が決まっている行）と、その条件の署名。
  const requests = useMemo(
    () =>
      base.flatMap(({ source, values }) => {
        const location = args.locations.find((candidate) => candidate.id === values.locationId);
        if (!location || !toPeriodDates(values.targetMonth)) return [];
        const signature = JSON.stringify([
          location.id,
          values.targetMonth,
          values.providerName,
          values.menuName,
          values.factorName,
          values.selectedFactorId,
          fiscalYearsKey,
        ]);
        return [{ key: source.key, signature, source, values, location }];
      }),
    [base, args.locations, fiscalYearsKey],
  );
  const requestsKey = requests.map((request) => `${request.key}=${request.signature}`).join('\n');

  useEffect(() => {
    catalogRef.current ??= createFactorCatalog();
    for (const request of requests) {
      if (views[request.key]?.signature === request.signature) continue;
      if (pendingRef.current.get(request.key) === request.signature) continue;
      pendingRef.current.set(request.key, request.signature);
      resolveRowFactor({
        energyType: request.source.energyType,
        targetMonth: request.values.targetMonth,
        location: request.location,
        fiscalYears: [...args.fiscalYears],
        choice: request.values,
        catalog: catalogRef.current,
      })
        .then((view) => ({ view, error: null }))
        .catch(() => ({ view: null, error: '排出係数を取得できませんでした。時間をおいて再度お試しください' }))
        .then(({ view, error }) => {
          // 解決している間に条件が変わっていれば、その結果は使わない（新しい条件で解決し直している）。
          if (!mountedRef.current || pendingRef.current.get(request.key) !== request.signature) return;
          pendingRef.current.delete(request.key);
          setViews((current) => ({ ...current, [request.key]: { signature: request.signature, view, error } }));
        });
    }
    // requests の中身は requestsKey で見る（毎回の描画で配列が作り直されるため）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestsKey, views]);

  const maxTargetMonth = getCurrentYearMonth();
  const rows = useMemo(() => {
    const signatures = new Map(requests.map((request) => [request.key, request.signature]));
    const built: ReviewRow[] = [];
    for (const { source, values } of base) {
      const resolved = views[source.key];
      const current = resolved && resolved.signature === signatures.get(source.key) ? resolved : null;
      const view = current?.view ?? null;
      const check = checkReviewRow({
        source,
        values,
        view,
        locations: args.locations,
        historyRecords: args.historyRecords,
        otherRows: built.filter((row) => row.include),
        maxTargetMonth,
      });
      const canInclude = check.errors.length === 0 && view !== null;
      const include = canInclude && (includeOverrides[source.key] ?? check.warnings.length === 0);
      built.push({
        source,
        values,
        view,
        check,
        canInclude,
        include,
        saveError: saveErrors[source.key] ?? null,
        factorError: current?.error ?? null,
      });
    }
    return built;
  }, [base, requests, views, args.locations, args.historyRecords, includeOverrides, saveErrors, maxTargetMonth]);

  /** 値を直す。事業者を替えたらメニューと候補の選び直しを外す。条件を替えたら、その行の登録の失敗の理由を消す */
  const setValue = useCallback((key: string, patch: Partial<ReviewRowValues>) => {
    setOverrides((current) => {
      const next = { ...current[key], ...patch };
      if ('providerName' in patch) {
        next.menuName = null;
        next.selectedFactorId = null;
      }
      return { ...current, [key]: next };
    });
    setSaveErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const setInclude = useCallback((key: string, include: boolean) => {
    setIncludeOverrides((current) => ({ ...current, [key]: include }));
  }, []);

  /** 登録できた行を表から外し、失敗した行に理由を出す */
  const applySaveResult = useCallback((result: { savedKeys: string[]; failures: Array<{ key: string; reason: string }> }) => {
    setSavedKeys((current) => new Set([...current, ...result.savedKeys]));
    setSaveErrors((current) => ({
      ...current,
      ...Object.fromEntries(result.failures.map((failure) => [failure.key, failure.reason])),
    }));
  }, []);

  const selected = rows.filter((row) => row.include);
  const entries = selected.flatMap((row) => {
    const entry: ActivityEntryInput | null = buildRowEntry(row);
    return entry ? [{ key: row.source.key, entry, evidenceFileIds: [row.source.evidence.id] }] : [];
  });

  return {
    rows,
    unregistrable,
    selected,
    entries,
    /** 表に出した行の数（登録済みで外した行を含まない） */
    count: rows.length,
    setValue,
    setInclude,
    applySaveResult,
    prefillOf: (row: ReviewRow) => buildRowPrefill(row),
  };
};

export type InvoiceReviewRows = ReturnType<typeof useInvoiceReviewRows>;
