import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCspReportQuota } from '@/lib/security/cspReport';
import { OPTIONS, POST } from '../route';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logging/logger', () => ({ logger: { warn } }));

const LOG_MESSAGE = 'CSP違反レポートを受信しました';

const createRequest = (body: string, headers: HeadersInit = {}): Request =>
  new Request('http://localhost:3000/api/csp-report', {
    method: 'POST',
    headers,
    body,
  });

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    warn.mockClear();
    resetCspReportQuota();
  });

  afterEach(() => {
    resetCspReportQuota();
  });

  it('valid CSP reports are accepted and logged', async () => {
    const response = await POST(
      createRequest(
        JSON.stringify({
          'csp-report': {
            'blocked-uri': 'https://example.com/script.js?token=secret#fragment',
            'document-uri': 'https://ghg.example.com/invite/abc?next=/dashboard',
            'effective-directive': 'script-src',
            'script-sample': 'alert(secret)',
          },
        }),
        {
          'content-type': 'application/csp-report',
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(warn).toHaveBeenCalledWith(
      {
        cspReport: {
          'blocked-uri': 'https://example.com/script.js',
          'document-uri': 'https://ghg.example.com/invite/[token]',
          'effective-directive': 'script-src',
        },
      },
      LOG_MESSAGE,
    );
  });

  it('accepts Reporting API batches and sanitizes URL fields before logging', async () => {
    const response = await POST(
      createRequest(
        JSON.stringify([
          {
            type: 'csp-violation',
            body: {
              blockedURL: 'https://cdn.example.com/file.js?signature=secret',
              documentURL: 'https://ghg.example.com/reset-password#token',
              effectiveDirective: 'script-src',
            },
          },
        ]),
        {
          'content-type': 'application/reports+json',
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      {
        cspReport: {
          blockedURL: 'https://cdn.example.com/file.js',
          documentURL: 'https://ghg.example.com/reset-password',
          effectiveDirective: 'script-src',
        },
      },
      LOG_MESSAGE,
    );
  });

  it('redacts non-http URL payloads before logging', async () => {
    const response = await POST(
      createRequest(
        JSON.stringify({
          'csp-report': {
            'blocked-uri': 'data:text/html;base64,c2VjcmV0',
            'source-file': 'blob:https://ghg.example.com/secret-object-id',
            'effective-directive': 'img-src',
          },
        }),
        {
          'content-type': 'application/csp-report',
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      {
        cspReport: {
          'blocked-uri': 'data:',
          'source-file': 'blob:https://ghg.example.com',
          'effective-directive': 'img-src',
        },
      },
      LOG_MESSAGE,
    );
  });

  it('rejects unsupported content types', async () => {
    const response = await POST(
      createRequest(JSON.stringify({}), { 'content-type': 'text/plain' }),
    );

    expect(response.status).toBe(415);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('accepts application/json so WebKit CSP reports are not dropped', async () => {
    // Safari/iOS は report-uri のレポートを application/json で送り、Reporting API には
    // 対応していない。415 で弾くと WebKit 系の違反が1件も記録されなくなる。
    const response = await POST(
      createRequest(
        JSON.stringify({
          'csp-report': {
            'document-uri': 'https://ghg.example.com/data-input',
            'effective-directive': 'frame-src',
          },
        }),
        { 'content-type': 'application/json' },
      ),
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      {
        cspReport: {
          'document-uri': 'https://ghg.example.com/data-input',
          'effective-directive': 'frame-src',
        },
      },
      LOG_MESSAGE,
    );
  });

  it('accepts CSP report content types with parameters', async () => {
    const response = await POST(
      createRequest(
        JSON.stringify({
          'csp-report': {
            'document-uri': 'https://ghg.example.com/dashboard',
            'effective-directive': 'connect-src',
          },
        }),
        { 'content-type': 'application/csp-report; charset=utf-8' },
      ),
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      {
        cspReport: {
          'document-uri': 'https://ghg.example.com/dashboard',
          'effective-directive': 'connect-src',
        },
      },
      LOG_MESSAGE,
    );
  });

  it('does not log the site own policy back into the log', async () => {
    const response = await POST(
      createRequest(
        JSON.stringify({
          'csp-report': {
            'original-policy': `default-src 'self'; ${'x'.repeat(600)}`,
            'effective-directive': 'script-src',
          },
        }),
        { 'content-type': 'application/csp-report' },
      ),
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      { cspReport: { 'effective-directive': 'script-src' } },
      LOG_MESSAGE,
    );
  });

  it('rejects invalid JSON reports', async () => {
    const response = await POST(
      createRequest('not json', { 'content-type': 'application/csp-report' }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects oversized reports before reading the body when content-length is present', async () => {
    const response = await POST(
      createRequest('{}', {
        'content-type': 'application/csp-report',
        'content-length': String(64 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
  });

  it('rejects invalid content-length headers', async () => {
    const response = await POST(
      createRequest('{}', {
        'content-type': 'application/csp-report',
        'content-length': '-1',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects non-numeric content-length headers', async () => {
    const response = await POST(
      createRequest('{}', {
        'content-type': 'application/csp-report',
        'content-length': 'not-a-number',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('rejects non-decimal content-length headers', async () => {
    const response = await POST(
      createRequest('{}', {
        'content-type': 'application/csp-report',
        'content-length': '1e3',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('caps logged reports from Reporting API batches', async () => {
    const reports = Array.from({ length: 25 }, (_, index) => ({
      type: 'csp-violation',
      body: {
        blockedURL: `https://cdn.example.com/${index}.js`,
        effectiveDirective: 'script-src',
      },
    }));

    const response = await POST(
      createRequest(JSON.stringify(reports), {
        'content-type': 'application/reports+json',
      }),
    );

    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(20);
  });

  it('rate limits a client that floods the endpoint', async () => {
    // proxy の認証ガードを外しているルートなので、ログ書き込みを外部から
    // 無制限に駆動されないよう件数で縛る。
    const send = () =>
      POST(
        createRequest(
          JSON.stringify({ 'csp-report': { 'effective-directive': 'script-src' } }),
          { 'content-type': 'application/csp-report', 'x-forwarded-for': '203.0.113.9' },
        ),
      );

    const responses = await Promise.all(Array.from({ length: 31 }, send));

    expect(responses.filter((response) => response.status === 204)).toHaveLength(30);
    const throttled = responses.find((response) => response.status === 429);
    expect(throttled?.headers.get('retry-after')).toBe('60');
  });
});

describe('OPTIONS /api/csp-report', () => {
  it('answers the CORS preflight so cross-origin report delivery is not dropped', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type');
  });
});
