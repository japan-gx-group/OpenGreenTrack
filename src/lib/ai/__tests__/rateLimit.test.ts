import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AI_ORGANIZATION_DAILY_LIMIT, type AiPurpose } from '../purposes';
import { AI_REQUEST_ACTION, DAILY_LIMIT_RETRY_AFTER_SECONDS, checkAiRateLimit } from '../rateLimit';

const purpose: AiPurpose = {
  label: 'テスト',
  inputs: ['text'],
  maxInputBytes: 1024,
  limits: { perMinute: 5, perDay: 100 },
  maxOutputTokens: 1000,
};

const NOW = Date.parse('2026-10-24T12:00:00Z');
const MINUTE_AGO = new Date(NOW - 60_000).toISOString();
const DAY_AGO = new Date(NOW - 86_400_000).toISOString();

interface CountQueryRecord {
  filters: Record<string, string>;
}

// select(…, { count, head }).eq().eq().gte()(.eq()) を、絞り込みの条件で件数を返す形で再現する。
const buildAdmin = (counts: { purposeMinute: number; purposeDay: number; organizationDay: number }, fail = false) => {
  const queries: CountQueryRecord[] = [];
  const admin = {
    from: (table: string) => {
      expect(table).toBe('system_audit_logs');
      return {
        select: () => {
          const record: CountQueryRecord = { filters: {} };
          queries.push(record);
          const query = {
            eq(column: string, value: string) {
              record.filters[column] = value;
              return query;
            },
            gte(column: string, value: string) {
              record.filters[`${column}>=`] = value;
              return query;
            },
            then(resolve: (value: { count: number | null; error: unknown }) => void) {
              if (fail) return resolve({ count: null, error: { message: 'boom' } });
              const since = record.filters['createdAt>='];
              const byPurpose = 'entityName' in record.filters;
              const count = since === MINUTE_AGO ? counts.purposeMinute : byPurpose ? counts.purposeDay : counts.organizationDay;
              resolve({ count, error: null });
            },
          };
          return query;
        },
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, queries };
};

describe('checkAiRateLimit', () => {
  it('上限の手前なら通す。数えるのは自組織の ai.request（用途は entityName）', async () => {
    const { admin, queries } = buildAdmin({ purposeMinute: 4, purposeDay: 99, organizationDay: AI_ORGANIZATION_DAILY_LIMIT - 1 });
    await expect(checkAiRateLimit(admin, 'org-1', 'test_purpose', purpose, NOW)).resolves.toEqual({ ok: true });
    expect(queries.map((q) => q.filters)).toEqual([
      { organizationId: 'org-1', action: AI_REQUEST_ACTION, 'createdAt>=': MINUTE_AGO, entityName: 'test_purpose' },
      { organizationId: 'org-1', action: AI_REQUEST_ACTION, 'createdAt>=': DAY_AGO, entityName: 'test_purpose' },
      { organizationId: 'org-1', action: AI_REQUEST_ACTION, 'createdAt>=': DAY_AGO },
    ]);
  });

  it('用途の 1 分の上限に当たったら 60 秒待たせる', async () => {
    const { admin } = buildAdmin({ purposeMinute: 5, purposeDay: 10, organizationDay: 10 });
    await expect(checkAiRateLimit(admin, 'org-1', 'test_purpose', purpose, NOW)).resolves.toEqual({
      ok: false,
      retryAfterSeconds: 60,
    });
  });

  it('用途の 24 時間の上限、組織全体の 24 時間の上限のどちらかに当たったら止める', async () => {
    const byPurpose = buildAdmin({ purposeMinute: 0, purposeDay: 100, organizationDay: 100 });
    await expect(checkAiRateLimit(byPurpose.admin, 'org-1', 'test_purpose', purpose, NOW)).resolves.toEqual({
      ok: false,
      retryAfterSeconds: DAILY_LIMIT_RETRY_AFTER_SECONDS,
    });
    const byOrganization = buildAdmin({ purposeMinute: 0, purposeDay: 0, organizationDay: AI_ORGANIZATION_DAILY_LIMIT });
    await expect(checkAiRateLimit(byOrganization.admin, 'org-1', 'test_purpose', purpose, NOW)).resolves.toMatchObject({
      ok: false,
    });
  });

  it('件数を数えられなければ、送らない側に倒す', async () => {
    const { admin } = buildAdmin({ purposeMinute: 0, purposeDay: 0, organizationDay: 0 }, true);
    await expect(checkAiRateLimit(admin, 'org-1', 'test_purpose', purpose, NOW)).resolves.toEqual({
      ok: false,
      countFailed: true,
    });
  });
});
