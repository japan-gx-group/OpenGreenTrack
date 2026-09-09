import { afterEach, describe, expect, it } from 'vitest';
import {
  consumeCspReportQuota,
  parseCspReports,
  redactSensitivePathSegments,
  resetCspReportQuota,
  sanitizeCspReport,
  sanitizeUrlForLog,
} from '../cspReport';

describe('redactSensitivePathSegments', () => {
  it('masks the invite token at the root of the path', () => {
    expect(redactSensitivePathSegments('/invite/abc123')).toBe('/invite/[token]');
  });

  it('masks the invite token when the app is served under a path prefix', () => {
    // APP_URL にパスを含む構成（invites.ts がパスを保つ）では document-uri が
    // /ghg/invite/TOKEN になる。先頭一致だと素通りしてトークンがログに残る。
    expect(redactSensitivePathSegments('/ghg/invite/abc123')).toBe('/ghg/invite/[token]');
  });

  it('keeps paths without an invite token untouched', () => {
    expect(redactSensitivePathSegments('/dashboard')).toBe('/dashboard');
  });
});

describe('sanitizeUrlForLog', () => {
  it('strips credentials, query and hash', () => {
    expect(sanitizeUrlForLog('https://user:pw@example.com/a.js?token=secret#frag')).toBe(
      'https://example.com/a.js',
    );
  });

  it('masks invite tokens behind a path prefix', () => {
    expect(sanitizeUrlForLog('https://example.com/ghg/invite/abc123?next=/dashboard')).toBe(
      'https://example.com/ghg/invite/[token]',
    );
  });

  it('masks invite tokens in values that are not parsable URLs', () => {
    expect(sanitizeUrlForLog('/ghg/invite/abc123?next=/dashboard')).toBe(
      '/ghg/invite/[token]',
    );
  });

  it('reduces non-http URLs to their scheme', () => {
    expect(sanitizeUrlForLog('data:text/html;base64,c2VjcmV0')).toBe('data:');
    expect(sanitizeUrlForLog('blob:https://example.com/object-id')).toBe(
      'blob:https://example.com',
    );
  });

  it('keeps CSP keywords as-is', () => {
    expect(sanitizeUrlForLog('inline')).toBe('inline');
    expect(sanitizeUrlForLog('eval')).toBe('eval');
    expect(sanitizeUrlForLog('self')).toBe('self');
  });
});

describe('sanitizeCspReport', () => {
  it('drops original-policy so the site does not log its own policy on every report', () => {
    expect(
      sanitizeCspReport({
        'csp-report': {
          'original-policy': "default-src 'self'",
          originalPolicy: "default-src 'self'",
          'effective-directive': 'script-src',
        },
      }),
    ).toEqual({ 'effective-directive': 'script-src' });
  });

  it('drops fields outside the allow list', () => {
    expect(
      sanitizeCspReport({
        'csp-report': { 'script-sample': 'alert(secret)', 'line-number': 12 },
      }),
    ).toEqual({ 'line-number': 12 });
  });

  it('marks unsupported value types instead of logging them', () => {
    expect(sanitizeCspReport({ 'csp-report': { disposition: { nested: true } } })).toEqual({
      disposition: '[unsupported]',
    });
  });
});

describe('parseCspReports', () => {
  it('returns null for invalid JSON', () => {
    expect(parseCspReports('not json')).toBeNull();
  });

  it('caps the number of reports taken from a batch', () => {
    const reports = Array.from({ length: 25 }, (_, index) => ({
      type: 'csp-violation',
      body: { blockedURL: `https://cdn.example.com/${index}.js` },
    }));

    expect(parseCspReports(JSON.stringify(reports))).toHaveLength(20);
  });

  it('drops reports with no loggable field', () => {
    expect(parseCspReports(JSON.stringify({ 'csp-report': { unknown: 'x' } }))).toEqual([]);
  });
});

describe('consumeCspReportQuota', () => {
  afterEach(() => {
    resetCspReportQuota();
  });

  const request = (ip: string) =>
    new Request('http://localhost:3000/api/csp-report', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    });

  it('allows a burst up to the per-client limit and then rejects', () => {
    const allowed = Array.from({ length: 31 }, () => consumeCspReportQuota(request('1.2.3.4')));

    expect(allowed.filter(Boolean)).toHaveLength(30);
    expect(allowed.at(-1)).toBe(false);
  });

  it('tracks clients independently', () => {
    Array.from({ length: 30 }, () => consumeCspReportQuota(request('1.2.3.4')));

    expect(consumeCspReportQuota(request('1.2.3.4'))).toBe(false);
    expect(consumeCspReportQuota(request('5.6.7.8'))).toBe(true);
  });

  it('caps the total volume even when the client IP is rotated', () => {
    // x-forwarded-for は詐称できるので、IP 単位の上限だけでは回避できてしまう。
    const allowed = Array.from({ length: 1200 }, (_, index) =>
      consumeCspReportQuota(request(`10.0.${Math.floor(index / 250)}.${index % 250}`)),
    );

    expect(allowed.filter(Boolean)).toHaveLength(1000);
  });
});
