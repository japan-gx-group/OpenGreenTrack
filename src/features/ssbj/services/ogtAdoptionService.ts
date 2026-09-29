// OGT の候補値の採用（T08b）を画面から扱うブラウザ側のサービス。
// 読み込みと取り消し（削除）は RLS のもとで直接行う。採用（書き込み）は Route Handler 経由だけ
// （/api/ssbj/reports/[reportId]/ogt-adoption）。テーブルに insert / update の権限は無い。

import { createClient } from '@/lib/supabase/client';
import type { OgtAdoptedValue, OgtSupplierReference, SsbjGhgAdoption } from '../types';

type SsbjOgtAdoptionRow = {
  adoptedValues: OgtAdoptedValue[];
  supplierReferences: OgtSupplierReference[];
  adoptedAt: string;
  adoptedByUserId: string;
};

/** レポートに採用済みの値一式。採用していなければ null。 */
export const getOgtAdoption = async (reportId: string): Promise<SsbjGhgAdoption | null> => {
  const { data, error } = await createClient()
    .from('ssbj_ogt_adoptions')
    .select('adoptedValues, supplierReferences, adoptedAt, adoptedByUserId')
    .eq('reportId', reportId)
    .maybeSingle();
  if (error) throw new Error('採用済みの値の取得に失敗しました');
  if (!data) return null;
  const row = data as SsbjOgtAdoptionRow;
  return {
    adoptedAt: row.adoptedAt,
    adoptedBy: row.adoptedByUserId,
    values: row.adoptedValues,
    supplierReferences: row.supplierReferences,
  };
};

/**
 * 画面に表示している候補値を採用する。送るのは候補値の指紋だけで、値はサーバが OGT から取り直す。
 * OGT の値が表示から変わっていればサーバが 409 で拒否し、そのメッセージを例外にする。
 */
export const adoptOgtCandidates = async (reportId: string, expectedFingerprint: string): Promise<{ adoptedAt: string }> => {
  const response = await fetch(`/api/ssbj/reports/${encodeURIComponent(reportId)}/ogt-adoption`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedFingerprint }),
  });
  const body = (await response.json().catch(() => null)) as { adoptedAt?: string; error?: string } | null;
  if (!response.ok || typeof body?.adoptedAt !== 'string') {
    throw new Error(body?.error ?? 'OGT の値の採用に失敗しました');
  }
  return { adoptedAt: body.adoptedAt };
};

/** 採用を取り消す（作業中の採用値を消す。作成済みの保存版は変わらない）。 */
export const clearOgtAdoption = async (reportId: string): Promise<void> => {
  const { error } = await createClient().from('ssbj_ogt_adoptions').delete().eq('reportId', reportId);
  if (error) throw new Error('採用の取り消しに失敗しました');
};
