import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../../../next.config';
import { buildRuntimeSecurityHeaders } from '../securityHeaders';

const REQUEST_ORIGIN = 'https://ghg.example.com';

const parseCspDirectives = (policy: string | undefined): Map<string, string[]> =>
  new Map(
    (policy ?? '')
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name = '', ...values] = directive.split(/\s+/);
        return [name, values] as const;
      }),
  );

const getHeaders = (requestOrigin: string | null = REQUEST_ORIGIN) =>
  buildRuntimeSecurityHeaders(requestOrigin);

const getCsp = (requestOrigin: string | null = REQUEST_ORIGIN): string | undefined =>
  getHeaders(requestOrigin)['Content-Security-Policy-Report-Only'];

const getCspDirectives = (requestOrigin: string | null = REQUEST_ORIGIN) =>
  parseCspDirectives(getCsp(requestOrigin));

describe('static security headers in next.config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets the environment-independent baseline headers', async () => {
    const headersConfig = await nextConfig.headers?.();
    expect(headersConfig).toHaveLength(1);
    expect(headersConfig?.[0]?.source).toBe('/:path*');

    const headerValues = Object.fromEntries(
      (headersConfig?.[0]?.headers ?? []).map(({ key, value }) => [key, value]),
    );

    expect(nextConfig.poweredByHeader).toBe(false);
    expect(headerValues['X-Frame-Options']).toBe('DENY');
    expect(headerValues['X-Content-Type-Options']).toBe('nosniff');
    expect(headerValues['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headerValues['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
    );
  });

  it('keeps environment-derived headers out of the build-time config', async () => {
    // これらはビルド時に固定されると実行時の .env と食い違うため proxy 側で付ける。
    vi.stubEnv('APP_URL', 'https://ghg.example.com');
    vi.stubEnv('NODE_ENV', 'production');

    const headersConfig = await nextConfig.headers?.();
    const keys = (headersConfig?.[0]?.headers ?? []).map(({ key }) => key);

    expect(keys).not.toContain('Content-Security-Policy-Report-Only');
    expect(keys).not.toContain('Reporting-Endpoints');
    expect(keys).not.toContain('Strict-Transport-Security');
  });
});

describe('runtime security headers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets CSP report-only with a report-uri fallback when APP_URL is unset', () => {
    vi.stubEnv('APP_URL', '');

    const headers = getHeaders();
    const csp = headers['Content-Security-Policy-Report-Only'];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).not.toContain('report-to csp-endpoint');
    expect(headers['Reporting-Endpoints']).toBeUndefined();
  });

  it('allows the configured Supabase origin and realtime websocket in CSP connect-src', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project-ref.supabase.co');

    const directives = getCspDirectives();

    expect(directives.get('connect-src')).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://project-ref.supabase.co',
        'wss://project-ref.supabase.co',
      ]),
    );
    expect(directives.get('img-src')).toEqual(
      expect.arrayContaining(["'self'", 'data:', 'blob:', 'https://project-ref.supabase.co']),
    );
    expect(directives.get('media-src')).toEqual(
      expect.arrayContaining(["'self'", 'blob:', 'https://project-ref.supabase.co']),
    );
    expect(directives.get('frame-src')).toEqual(
      expect.arrayContaining(["'self'", 'blob:', 'https://project-ref.supabase.co']),
    );
  });

  it('allows local Supabase HTTP and websocket sources for local development', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');

    expect(getCspDirectives().get('connect-src')).toEqual(
      expect.arrayContaining(['http://127.0.0.1:54321', 'ws://127.0.0.1:54321']),
    );
  });

  it('omits development-only script and connect sources in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const csp = getCsp();

    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('http://localhost:*');
    expect(csp).not.toContain('ws://localhost:*');
    expect(csp).not.toContain('http://127.0.0.1:*');
    expect(csp).not.toContain('ws://127.0.0.1:*');
  });

  it('ignores Supabase URLs that do not use HTTP or HTTPS', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'ftp://project-ref.supabase.co');

    const csp = getCsp();

    expect(csp).not.toContain('ftp://project-ref.supabase.co');
    expect(csp).not.toContain('ws://project-ref.supabase.co');
  });

  it('adds Reporting-Endpoints when APP_URL matches the request origin', () => {
    vi.stubEnv('APP_URL', 'https://ghg.example.com');

    const headers = getHeaders('https://ghg.example.com');

    expect(headers['Content-Security-Policy-Report-Only']).toContain(
      'report-uri /api/csp-report',
    );
    expect(headers['Content-Security-Policy-Report-Only']).toContain('report-to csp-endpoint');
    expect(headers['Reporting-Endpoints']).toBe(
      'csp-endpoint="https://ghg.example.com/api/csp-report"',
    );
  });

  it('keeps the APP_URL path prefix in the report target', () => {
    vi.stubEnv('APP_URL', 'https://example.com/ghg/');

    const headers = getHeaders('https://example.com');

    expect(headers['Content-Security-Policy-Report-Only']).toContain(
      'report-uri /ghg/api/csp-report',
    );
    expect(headers['Reporting-Endpoints']).toBe(
      'csp-endpoint="https://example.com/ghg/api/csp-report"',
    );
  });

  it('falls back to report-uri when APP_URL is a different origin than the request', () => {
    // クロスオリジンの Reporting-Endpoints はプリフライトで落ち、report-to があると
    // Chrome は report-uri を無視するため、1件も届かなくなる。
    vi.stubEnv('APP_URL', 'https://ghg.example.com');

    const headers = getHeaders('https://internal.example.local');

    expect(headers['Content-Security-Policy-Report-Only']).toContain(
      'report-uri /api/csp-report',
    );
    expect(headers['Content-Security-Policy-Report-Only']).not.toContain('report-to');
    expect(headers['Reporting-Endpoints']).toBeUndefined();
  });

  it('keeps Reporting-Endpoints disabled for non-HTTPS APP_URL in production', () => {
    vi.stubEnv('APP_URL', 'http://ghg.example.com');
    vi.stubEnv('NODE_ENV', 'production');

    const headers = getHeaders('http://ghg.example.com');

    expect(headers['Content-Security-Policy-Report-Only']).toContain(
      'report-uri /api/csp-report',
    );
    expect(headers['Content-Security-Policy-Report-Only']).not.toContain('report-to');
    expect(headers['Reporting-Endpoints']).toBeUndefined();
  });

  it('keeps Reporting-Endpoints disabled when APP_URL is invalid', () => {
    vi.stubEnv('APP_URL', 'localhost:3000');

    const headers = getHeaders();

    expect(headers['Content-Security-Policy-Report-Only']).toContain(
      'report-uri /api/csp-report',
    );
    expect(headers['Reporting-Endpoints']).toBeUndefined();
  });

  it('keeps Reporting-Endpoints disabled when APP_URL uses an unsupported protocol', () => {
    vi.stubEnv('APP_URL', 'ftp://ghg.example.com');

    const headers = getHeaders();

    expect(headers['Content-Security-Policy-Report-Only']).toContain(
      'report-uri /api/csp-report',
    );
    expect(headers['Reporting-Endpoints']).toBeUndefined();
  });
});

describe('Strict-Transport-Security', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is omitted outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');

    expect(getHeaders()['Strict-Transport-Security']).toBeUndefined();
  });

  it('does not include subdomains by default', () => {
    // apex ドメイン配信時に兄弟サブドメインまで巻き込むのを避けるため既定では付けない。
    vi.stubEnv('NODE_ENV', 'production');

    expect(getHeaders()['Strict-Transport-Security']).toBe('max-age=63072000');
  });

  it('opts into includeSubDomains only when explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HSTS_INCLUDE_SUBDOMAINS', 'true');

    expect(getHeaders()['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains',
    );
  });

  it('honours a custom max-age and can be disabled with zero', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HSTS_MAX_AGE', '300');
    expect(getHeaders()['Strict-Transport-Security']).toBe('max-age=300');

    vi.stubEnv('HSTS_MAX_AGE', '0');
    expect(getHeaders()['Strict-Transport-Security']).toBeUndefined();
  });

  it('falls back to the default max-age for malformed values', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('HSTS_MAX_AGE', 'forever');

    expect(getHeaders()['Strict-Transport-Security']).toBe('max-age=63072000');
  });
});
