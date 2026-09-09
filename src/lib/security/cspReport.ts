/**
 * CSP 違反レポートの受信処理。
 *
 * Route Handler（src/app/api/csp-report/route.ts）は薄く保つ規約（AGENTS.md R2）のため、
 * 本文の読み取り・検証・ログ用サニタイズはここに置く。単体テストからも直接叩ける。
 */

import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';

export const MAX_REPORT_BYTES = 64 * 1024;
export const MAX_REPORTS_PER_REQUEST = 20;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

const MAX_LOG_VALUE_LENGTH = 500;

// Safari/WebKit は report-uri のレポートを application/json で送り、Reporting API
// （report-to / Reporting-Endpoints）には対応していない。application/json を弾くと
// iOS を含む WebKit 系からの違反が丸ごと記録されなくなり、強制ポリシーへ切り替える際の
// 判断材料が欠けるため受け付ける。
const ALLOWED_CONTENT_TYPES = new Set([
  'application/csp-report',
  'application/reports+json',
  'application/json',
]);

const URL_REPORT_FIELDS = new Set([
  'blocked-uri',
  'document-uri',
  'referrer',
  'source-file',
  'blockedURL',
  'documentURL',
  'sourceFile',
]);

// original-policy（自分が送ったポリシー全文）は既知の値で診断価値が無い一方、
// 500文字で切られた状態で全レポートに乗るとログ量が数倍に膨らむため入れない。
const ALLOWED_REPORT_FIELDS = new Set([
  'blocked-uri',
  'blockedURL',
  'column-number',
  'columnNumber',
  'disposition',
  'document-uri',
  'documentURL',
  'effective-directive',
  'effectiveDirective',
  'line-number',
  'lineNumber',
  'referrer',
  'source-file',
  'sourceFile',
  'status-code',
  'statusCode',
  'violated-directive',
  'violatedDirective',
]);

export type LimitedBodyResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string };

export type SanitizedCspReport = Record<string, string | number | boolean | null>;

const getContentType = (request: Request): string =>
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';

export const isAllowedCspReportContentType = (request: Request): boolean =>
  ALLOWED_CONTENT_TYPES.has(getContentType(request));

const isDecimalContentLength = (value: string): boolean => /^\d+$/.test(value);

const truncateLogValue = (value: string): string =>
  value.length > MAX_LOG_VALUE_LENGTH
    ? `${value.slice(0, MAX_LOG_VALUE_LENGTH)}...[truncated]`
    : value;

// 招待トークンは1回きりとはいえ、ログに残ると閲覧権限がある人が組織へ参加できてしまう。
// APP_URL をパス配下（例: https://example.com/ghg/invite/TOKEN）に置く構成もあるため、
// 先頭一致ではなく文字列中のどこにあってもマスクする。
const INVITE_TOKEN_PATTERN = /\/invite\/[^/?#]+/g;

export const redactSensitivePathSegments = (value: string): string =>
  value.replace(INVITE_TOKEN_PATTERN, '/invite/[token]');

const sanitizeNonHttpUrlForLog = (url: URL): string => {
  if (url.protocol === 'blob:') {
    try {
      const blobUrl = new URL(url.pathname);
      if (blobUrl.protocol === 'http:' || blobUrl.protocol === 'https:') {
        return `blob:${blobUrl.origin}`;
      }
    } catch {
      return 'blob:';
    }
  }

  return url.protocol;
};

export const sanitizeUrlForLog = (value: string): string => {
  if (value === 'inline' || value === 'eval' || value === 'self') return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return sanitizeNonHttpUrlForLog(url);
    }
    url.username = '';
    url.password = '';
    url.pathname = redactSensitivePathSegments(url.pathname);
    url.search = '';
    url.hash = '';
    return truncateLogValue(url.toString());
  } catch {
    const withoutQueryOrHash = value.split('?')[0]?.split('#')[0] ?? value;
    return truncateLogValue(redactSensitivePathSegments(withoutQueryOrHash));
  }
};

const sanitizeReportValue = (key: string, value: unknown): string | number | boolean | null => {
  if (typeof value === 'string') {
    return URL_REPORT_FIELDS.has(key)
      ? sanitizeUrlForLog(value)
      : truncateLogValue(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return '[unsupported]';
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const getReportBody = (report: unknown): Record<string, unknown> | null => {
  const record = asRecord(report);
  if (!record) return null;

  const cspReport = asRecord(record['csp-report']);
  if (cspReport) return cspReport;

  const reportingApiBody = asRecord(record.body);
  if (record.type === 'csp-violation' && reportingApiBody) return reportingApiBody;

  return record;
};

export const sanitizeCspReport = (report: unknown): SanitizedCspReport => {
  const body = getReportBody(report);
  if (!body) return {};

  return Object.fromEntries(
    Object.entries(body)
      .filter(([key]) => ALLOWED_REPORT_FIELDS.has(key))
      .map(([key, value]) => [key, sanitizeReportValue(key, value)]),
  );
};

/** JSON を解析し、ログに出せる形へ整えたレポート一覧を返す。解析できなければ null */
export const parseCspReports = (text: string): SanitizedCspReport[] | null => {
  let report: unknown;
  try {
    report = JSON.parse(text) as unknown;
  } catch {
    return null;
  }

  return (Array.isArray(report) ? report : [report])
    .slice(0, MAX_REPORTS_PER_REQUEST)
    .map(sanitizeCspReport)
    .filter((sanitizedReport) => Object.keys(sanitizedReport).length > 0);
};

export const readLimitedBody = async (request: Request): Promise<LimitedBodyResult> => {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    if (!isDecimalContentLength(contentLength)) {
      return { ok: false, status: 400, error: 'Invalid CSP report content length' };
    }
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > MAX_REPORT_BYTES) {
      return { ok: false, status: 413, error: 'CSP report is too large' };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: '' };

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.byteLength;
    if (totalLength > MAX_REPORT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413, error: 'CSP report is too large' };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return { ok: true, text: new TextDecoder().decode(body) };
};

// /api/csp-report は proxy の認証ガードを外している唯一のルートなので、代わりに件数で縛る。
// 送信元 IP 単位に加えて全体の上限も持つ: x-forwarded-for は詐称できるため、IP 単位だけだと
// ヘッダを振り替えるだけで上限を回避され、ログ基盤の取り込み上限を食い潰されてしまう。
const perClientRateLimiter = createFixedWindowRateLimiter({
  limit: 30,
  windowMs: RATE_LIMIT_WINDOW_SECONDS * 1000,
});
const globalRateLimiter = createFixedWindowRateLimiter({
  limit: 1000,
  windowMs: RATE_LIMIT_WINDOW_SECONDS * 1000,
  maxKeys: 1,
});

const getClientKey = (request: Request): string => {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (forwardedFor) return forwardedFor;
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
};

export const consumeCspReportQuota = (request: Request): boolean =>
  globalRateLimiter.consume('global') && perClientRateLimiter.consume(getClientKey(request));

/** テスト用。レートリミッタの状態をリセットする */
export const resetCspReportQuota = (): void => {
  perClientRateLimiter.reset();
  globalRateLimiter.reset();
};
