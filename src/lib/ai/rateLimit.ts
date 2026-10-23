// AI の回数の上限（サーバ専用）。用途ごと（1 分あたり・24 時間あたり）と、組織全体（24 時間あたり）で数える。
//
// 数えるのは監査ログ（system_audit_logs の action = 'ai.request'）の件数（src/lib/security/apiRateLimit.ts と同じく、
// 追加の依存を使わず DB で数える方式）。用途は監査ログの entityName に入っている。
// 既知の限界: 監査ログは呼び出しが終わってから書くので、同時に走っている呼び出しは数に入らない
// （同時に送れる数だけ上限を少し超えうる）。上限は暴走（連打・スクリプト）を止める番人で、厳密な課金の上限ではない。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_ORGANIZATION_DAILY_LIMIT, type AiPurpose } from './purposes';

export const AI_REQUEST_ACTION = 'ai.request';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** 24 時間の上限に当たったときに返す、待つ時間の目安（窓が少しずつ空くため、1 時間おいて試してもらう） */
export const DAILY_LIMIT_RETRY_AFTER_SECONDS = 60 * 60;

export type AiRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number }
  /** 件数を数えられなかった（送らない側に倒す） */
  | { ok: false; countFailed: true };

const countRequests = async (
  admin: SupabaseClient,
  organizationId: string,
  since: Date,
  purposeId?: string,
): Promise<number> => {
  let query = admin
    .from('system_audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('organizationId', organizationId)
    .eq('action', AI_REQUEST_ACTION)
    .gte('createdAt', since.toISOString());
  if (purposeId) query = query.eq('entityName', purposeId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
};

export const checkAiRateLimit = async (
  admin: SupabaseClient,
  organizationId: string,
  purposeId: string,
  purpose: AiPurpose,
  now: number = Date.now(),
): Promise<AiRateLimitResult> => {
  let counts: [number, number, number];
  try {
    counts = await Promise.all([
      countRequests(admin, organizationId, new Date(now - MINUTE_MS), purposeId),
      countRequests(admin, organizationId, new Date(now - DAY_MS), purposeId),
      countRequests(admin, organizationId, new Date(now - DAY_MS)),
    ]);
  } catch {
    return { ok: false, countFailed: true };
  }
  const [purposePerMinute, purposePerDay, organizationPerDay] = counts;

  if (purposePerMinute >= purpose.limits.perMinute) {
    return { ok: false, retryAfterSeconds: MINUTE_MS / 1000 };
  }
  if (purposePerDay >= purpose.limits.perDay || organizationPerDay >= AI_ORGANIZATION_DAILY_LIMIT) {
    return { ok: false, retryAfterSeconds: DAILY_LIMIT_RETRY_AFTER_SECONDS };
  }
  return { ok: true };
};
