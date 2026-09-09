'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeading } from '@/components/layout/PageHeading';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshingIndicator } from '@/components/ui/RefreshingIndicator';
import { LoadingIndicator } from '@/components/ui/PageLoading';
import { useFiscalYear } from '@/hooks/useFiscalYear';
import { getLocationById } from '@/features/locations/services/locationService';
import { LocationStatusBadge } from '@/features/locations/components/LocationStatusBadge';
import {
  getLocationDetailData,
  type LocationDetailData,
} from '@/features/locations/services/locationDetailService';
import {
  getLocationTypeLabel,
  getRegionLabel,
  type LocationRecord,
} from '@/features/locations/types';

const formatNumber = (value: number) =>
  new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 3,
  }).format(value);

// Scope別サマリーカードの表示定義。ドット色はダッシュボードのKPIバンドと同じトークンを使う。
const SCOPE_CARDS = [
  { key: 'scope1', title: 'Scope 1', dotColor: 'var(--color-scope-1)' },
  { key: 'scope2', title: 'Scope 2', dotColor: 'var(--color-scope-2)' },
  { key: 'scope3', title: 'Scope 3', dotColor: 'var(--color-scope-3)' },
  { key: 'total', title: '合計', dotColor: 'var(--color-primary)' },
] as const;

export const LocationDetail = ({ locationId }: { locationId: string }) => {
  const { fiscalYear, fiscalYearId, fiscalYears, isLoading: isFiscalYearLoading } = useFiscalYear();
  // 年度が1件も無い（初期セットアップ直後・最後の年度を削除した後）。fiscalYear が空文字の
  // ままだと集計データの取得 effect が走らず「読み込んでいます...」から抜けられないため、
  // Context のロード完了後に判定して空状態の案内へ切り替える。
  const hasNoFiscalYear = !isFiscalYearLoading && fiscalYears.length === 0;

  const [location, setLocation] = useState<LocationRecord | null>(null);
  const [isLocationLoading, setIsLocationLoading] = useState(true);
  const [locationErrorMessage, setLocationErrorMessage] = useState('');

  const [detail, setDetail] = useState<LocationDetailData | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(true);
  const [detailErrorMessage, setDetailErrorMessage] = useState('');

  // 拠点そのものの取得。存在しない・他組織の拠点は null（Not Found 表示）。
  useEffect(() => {
    let isMounted = true;

    const loadLocation = async () => {
      setIsLocationLoading(true);
      setLocationErrorMessage('');

      try {
        const record = await getLocationById(locationId);
        if (isMounted) {
          setLocation(record);
        }
      } catch (error) {
        if (isMounted) {
          setLocationErrorMessage(
            error instanceof Error ? error.message : '拠点の取得に失敗しました',
          );
        }
      } finally {
        if (isMounted) {
          setIsLocationLoading(false);
        }
      }
    };

    void loadLocation();

    return () => {
      isMounted = false;
    };
  }, [locationId]);

  // 集計データの取得。年度切替（Headerの年度セレクタ）に追従する。
  // 切替中は直前のデータを保持して白画面を避け、RefreshingIndicator で更新中を明示する
  // （stale-while-revalidate。ダッシュボードと同じ方針）。
  useEffect(() => {
    // FiscalYearContext のロード完了前は fiscalYear が空文字。このまま取得すると
    // 不正な年度クエリでエラー表示になるため、実際の年度が入るまで待つ。
    if (fiscalYear === '') return;

    let isMounted = true;

    const loadDetail = async () => {
      setIsDetailLoading(true);
      setDetailErrorMessage('');

      try {
        const data = await getLocationDetailData(fiscalYear, locationId, fiscalYearId);
        if (isMounted) {
          setDetail(data);
        }
      } catch (error) {
        if (isMounted) {
          setDetail(null);
          setDetailErrorMessage(
            error instanceof Error ? error.message : '拠点別データの取得に失敗しました',
          );
        }
      } finally {
        if (isMounted) {
          setIsDetailLoading(false);
        }
      }
    };

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [fiscalYear, fiscalYearId, locationId]);

  const isNotFound = !isLocationLoading && !locationErrorMessage && location === null;
  const hasScope3 = detail?.hasScope3 ?? false;
  const visibleScopeCards = SCOPE_CARDS.filter(card => card.key !== 'scope3' || hasScope3);
  const chartData = detail?.monthlyData ?? [];

  return (
    <>
      <div className="page-content gt-scroll relative">
        <PageHeading
          title={location ? location.name : '拠点詳細'}
          description="拠点別の Scope 内訳と活動量"
          primaryAction={null}
        />
        <div className="flex flex-col" style={{ gap: '14px' }}>
        {/* 戻るリンク + 拠点の基本情報（種別・地域） */}
        <div className="flex items-center justify-between shrink-0">
          <Link
            href="/locations"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft size={16} /> 拠点一覧へ戻る
          </Link>
          {location && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="neutral">{getLocationTypeLabel(location.type)}</Badge>
              <Badge variant="neutral">{getRegionLabel(location.region)}</Badge>
              <LocationStatusBadge status={location.status} />
            </div>
          )}
        </div>

        {locationErrorMessage && (
          <div
            className="rounded-md px-4 py-3 text-sm"
            style={{ border: '1px solid var(--color-danger)', backgroundColor: 'var(--color-bg-card)', color: 'var(--color-danger)' }}
          >
            {locationErrorMessage}
          </div>
        )}

        {/* 存在しない・他組織の拠点（RLSで不可視）は Not Found 表示にする */}
        {isNotFound ? (
          <Card className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 size={48} className="text-text-muted mb-3 opacity-50" />
            <p className="font-bold text-text-muted text-lg">拠点が見つかりません</p>
            <p className="text-sm text-text-muted mt-2">
              拠点が削除されたか、URLが正しくない可能性があります。
            </p>
            <Link href="/locations" className="gt-btn mt-6">
              拠点一覧へ戻る
            </Link>
          </Card>
        ) : hasNoFiscalYear ? (
          /* 年度未登録の空状態（拠点そのものは表示できるが、年度別の集計は出せない） */
          <Card className="text-sm text-text-muted">
            <p className="m-0">算定年度が登録されていません。企業設定から年度を追加してください。</p>
            <Link href="/settings/company" className="gt-btn mt-4">
              企業設定へ
            </Link>
          </Card>
        ) : (
          <>
            {detailErrorMessage && (
              <div
                className="rounded-md px-4 py-3 text-sm"
                style={{ border: '1px solid var(--color-danger)', backgroundColor: 'var(--color-bg-card)', color: 'var(--color-danger)' }}
              >
                {detailErrorMessage}
              </div>
            )}

            <RefreshingIndicator show={isDetailLoading && Boolean(detail)} />

            {!detail ? (
              !detailErrorMessage && (
                <Card className="text-sm text-text-muted">
                  {isDetailLoading || isLocationLoading ? (
                    <LoadingIndicator label="拠点別データを読み込んでいます..." />
                  ) : (
                    '表示できる排出量データがありません。'
                  )}
                </Card>
              )
            ) : !detail.hasData ? (
              /* 選択中年度に活動量データが1件も無い場合の空状態 */
              <Card className="flex flex-col items-center justify-center py-16 text-center">
                <Building2 size={48} className="text-text-muted mb-3 opacity-50" />
                <p className="font-bold text-text-muted text-lg">
                  {fiscalYear}年度の活動量データはまだ登録されていません
                </p>
                <p className="text-sm text-text-muted mt-2">
                  データ入力画面から活動量を登録すると、この拠点のScope内訳が表示されます。
                </p>
              </Card>
            ) : (
              <>
                {/* ===== Scope別 年間排出量サマリー ===== */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
                  {visibleScopeCards.map(card => (
                    <Card key={card.key}>
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <span
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '3px',
                            backgroundColor: card.dotColor,
                          }}
                        />
                        {card.title}
                      </div>
                      <div className="flex items-baseline gap-2 mt-3">
                        <span
                          style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: '30px', lineHeight: 1 }}
                        >
                          {formatNumber(detail.totals[card.key])}
                        </span>
                        <span className="text-xs text-text-muted">t-CO2e</span>
                      </div>
                    </Card>
                  ))}
                </div>

                {/* ===== 月別×Scope別 積み上げチャート ===== */}
                <Card className="flex flex-col shrink-0" style={{ padding: '24px 26px' }}>
                  <div className="flex justify-between items-baseline">
                    <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: '19px', margin: 0 }}>
                      月別排出量推移（{fiscalYear}年度）
                    </h2>
                    <div className="flex items-center" style={{ gap: '16px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                      <span className="flex items-center" style={{ gap: '6px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: 'var(--color-scope-1)' }} />
                        Scope 1
                      </span>
                      <span className="flex items-center" style={{ gap: '6px' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: 'var(--color-scope-2)' }} />
                        Scope 2
                      </span>
                      {hasScope3 && (
                        <span className="flex items-center" style={{ gap: '6px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '3px', backgroundColor: 'var(--color-scope-3)' }} />
                          Scope 3
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--color-text-label)', marginTop: '12px' }}>t-CO2e</div>
                  <div className="w-full" style={{ height: '270px', marginTop: '8px' }}>
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-label)' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--color-text-label)' }} width={44} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: 'var(--color-bg-card)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="scope1" stackId="a" fill="var(--color-scope-1)" maxBarSize={44} name="Scope 1" />
                        {/* Scope 3 が無い場合は Scope 2 が積み上げの最上段になるため、角丸を付け替える。 */}
                        <Bar
                          dataKey="scope2"
                          stackId="a"
                          fill="var(--color-scope-2)"
                          maxBarSize={44}
                          name="Scope 2"
                          radius={hasScope3 ? undefined : [4, 4, 0, 0]}
                        />
                        {hasScope3 && (
                          <Bar dataKey="scope3" stackId="a" fill="var(--color-scope-3)" radius={[4, 4, 0, 0]} maxBarSize={44} name="Scope 3" />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {hasScope3 && (
                    <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '8px' }}>
                      ※ Scope 3 はこの拠点の活動量データに紐づく算定結果のみです。組織全体のScope 3集計（年度単位）とは一致しない場合があります。
                    </p>
                  )}
                </Card>

                {/* ===== カテゴリ別の内訳 =====
                    エネルギー・燃料だけでなく水道・廃棄物・出張なども並ぶため「エネルギー種別」とは呼ばない。 */}
                <Card className="flex flex-col shrink-0" style={{ padding: '24px 26px' }}>
                  <div className="flex justify-between items-baseline">
                    <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: '19px', margin: 0 }}>
                      カテゴリ別内訳
                    </h3>
                    <span style={{ fontSize: '12px', color: 'var(--color-text-label)' }}>
                      計 {formatNumber(detail.totals.total)} t-CO2e
                    </span>
                  </div>

                  <div className="overflow-x-auto mt-4">
                    <table className="text-sm w-full">
                      <thead>
                        <tr className="border-b border-border text-left text-text-muted">
                          <th className="font-medium pb-2 pr-4">カテゴリ</th>
                          <th className="font-medium pb-2 pr-4 text-right">活動量</th>
                          <th className="font-medium pb-2 pr-4 text-right">排出量（t-CO2e）</th>
                          <th className="font-medium pb-2 pl-4 w-[30%]">構成比</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.energyBreakdown.map(row => (
                          <tr key={row.energyType} className="border-b border-border-light">
                            <td className="py-3 pr-4 font-bold">{row.label}</td>
                            <td className="py-3 pr-4 text-right">
                              {row.amounts
                                .map(entry => `${formatNumber(entry.amount)} ${entry.unit}`)
                                .join(' / ')}
                            </td>
                            <td className="py-3 pr-4 text-right font-medium">{formatNumber(row.emissions)}</td>
                            <td className="py-3 pl-4">
                              <div className="flex items-center gap-3">
                                <div
                                  className="rounded-full flex-1"
                                  style={{
                                    height: '8px',
                                    backgroundColor: 'var(--color-chart-track)',
                                    overflow: 'hidden',
                                  }}
                                >
                                  <div
                                    className="rounded-full"
                                    style={{
                                      width: `${row.percent}%`,
                                      height: '100%',
                                      backgroundColor: 'var(--color-primary)',
                                    }}
                                  />
                                </div>
                                <span className="text-xs text-text-muted w-12 text-right">
                                  {row.percent.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '12px' }}>
                    ※ 排出量が0のカテゴリは、活動量は登録済みで算定が未実行の可能性があります。
                  </p>
                </Card>
              </>
            )}
          </>
        )}
        </div>
      </div>
    </>
  );
};
