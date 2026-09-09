/**
 * セキュリティレスポンスヘッダの組み立て。
 *
 * next.config.ts の `headers()` は `next build` 時に一度だけ評価され、結果が
 * `.next/routes-manifest.json` に固定される。一方 APP_URL / NEXT_PUBLIC_SUPABASE_URL は
 * 実行時の `.env.local` で切り替える運用（docs/setup-guide.md）なので、ビルド成果物を
 * 使い回す構成（CI でビルドした artifact・Docker イメージ・staging から本番への昇格）では
 * ビルド時の値が焼き込まれたまま配信されてしまう。
 *
 * そのため環境変数から導出するヘッダ（CSP / Reporting-Endpoints / HSTS）はここで組み立て、
 * リクエストごとに評価される proxy.ts から適用する。next.config.ts には環境に依存しない
 * 静的ヘッダだけを残す。
 */

type SupabaseCspSources = {
  origin: string;
  websocketOrigin: string;
};

export type CspReporting = {
  /** report-uri に載せる同一オリジンのパス */
  reportPath: string;
  /** Reporting-Endpoints / report-to に載せる絶対URL。使えない構成では null */
  reportToUrl: string | null;
};

export const CSP_REPORT_PATH = '/api/csp-report';
const CSP_REPORT_ENDPOINT_GROUP = 'csp-endpoint';
const DEFAULT_HSTS_MAX_AGE = 63072000;

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

const parseAppUrl = (): URL | null => {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return null;

  try {
    const url = new URL(appUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
};

const isEnvEnabled = (value: string | undefined): boolean =>
  value?.trim().toLowerCase() === 'true';

export const resolveCspReporting = (requestOrigin: string | null): CspReporting => {
  const appUrl = parseAppUrl();
  if (!appUrl) return { reportPath: CSP_REPORT_PATH, reportToUrl: null };

  // APP_URL はパス配下（例: https://example.com/ghg）への配信も許容している構成で、
  // invites.ts の resolveRequestOrigin も末尾スラッシュを落とすだけでパスを保っている。
  // origin だけを見るとプレフィックスが落ち、その位置にある無関係なサービスへ
  // 違反レポート（document-uri や referrer を含む）を送らせてしまうため、パスを保つ。
  const basePath = appUrl.pathname.replace(/\/+$/, '');
  const reportPath = `${basePath}${CSP_REPORT_PATH}`;

  // Reporting API（report-to）は絶対URLしか受け付けない。ブラウザが実際に接続している
  // オリジンと違う値を出すとレポート送信がクロスオリジンになり、CORS プリフライトで落ちる。
  // さらに CSP3 では report-to に対応した UA は report-uri を無視する（Chrome はこの挙動）ため、
  // 不一致のまま report-to を出すと1件も届かなくなる。一致するときだけ report-to を出し、
  // それ以外は同一オリジンの report-uri に任せる。
  //
  // なお出力する URL は常に運用者が設定した APP_URL 由来で、リクエストヘッダ由来の値は
  // 一致判定にしか使わない。Host を偽装されても report-to を無効化できるだけで、
  // 別オリジンへレポートを送らせることはできない。
  if (isProduction() && appUrl.protocol !== 'https:') return { reportPath, reportToUrl: null };
  if (!requestOrigin || requestOrigin !== appUrl.origin) return { reportPath, reportToUrl: null };

  return { reportPath, reportToUrl: `${appUrl.origin}${reportPath}` };
};

const getSupabaseCspSources = (): SupabaseCspSources[] => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return [];

  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
    const websocketProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return [{ origin: url.origin, websocketOrigin: `${websocketProtocol}//${url.host}` }];
  } catch {
    return [];
  }
};

export const buildContentSecurityPolicy = (reporting: CspReporting): string => {
  const supabaseSources = getSupabaseCspSources();
  const supabaseOrigins = supabaseSources.map(({ origin }) => origin);
  const supabaseConnectOrigins = supabaseSources.flatMap(({ origin, websocketOrigin }) => [
    origin,
    websocketOrigin,
  ]);
  const developmentSources = isProduction()
    ? []
    : ['http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*', 'ws://127.0.0.1:*'];

  // CSP はまず Report-Only で導入する。Next.js の App Router と既存の inline style があるため、
  // 強制ポリシーへ切り替える場合は nonce/hash 方針を別途固めてから unsafe-inline を外す。
  const directives = [
    ["default-src", "'self'"],
    ["base-uri", "'self'"],
    ["object-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["form-action", "'self'"],
    [
      "script-src",
      "'self'",
      "'unsafe-inline'",
      ...(isProduction() ? [] : ["'unsafe-eval'"]),
    ],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", 'data:', 'blob:', ...supabaseOrigins],
    ["font-src", "'self'", 'data:'],
    ["connect-src", "'self'", ...supabaseConnectOrigins, ...developmentSources],
    ["worker-src", "'self'", 'blob:'],
    ["media-src", "'self'", 'blob:', ...supabaseOrigins],
    ["frame-src", "'self'", 'blob:', ...supabaseOrigins],
    ["manifest-src", "'self'"],
    ["report-uri", reporting.reportPath],
    ...(reporting.reportToUrl ? [["report-to", CSP_REPORT_ENDPOINT_GROUP]] : []),
  ];

  return directives.map((directive) => directive.join(' ')).join('; ');
};

const parseHstsMaxAge = (): number => {
  const raw = process.env.HSTS_MAX_AGE?.trim();
  if (!raw) return DEFAULT_HSTS_MAX_AGE;
  if (!/^\d+$/.test(raw)) return DEFAULT_HSTS_MAX_AGE;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_HSTS_MAX_AGE;
};

/**
 * HSTS の値を返す（本番のみ。`HSTS_MAX_AGE=0` で無効化できる）。
 *
 * includeSubDomains は既定で付けない。apex ドメイン（example.com）へ配信している場合、
 * 1度アクセスしただけで兄弟サブドメイン（社内ツールや http のみの旧システム）まで
 * max-age の期間ずっと HTTPS 固定になり、しかもブラウザ側の HSTS キャッシュに残るため
 * サーバからヘッダを外しても復旧できない（利用者全員に手動クリアが必要になる）。
 * 専用サブドメインで運用していて全サブドメインが HTTPS 化済みの場合だけ
 * `HSTS_INCLUDE_SUBDOMAINS=true` で opt-in する。
 */
export const buildStrictTransportSecurity = (): string | null => {
  if (!isProduction()) return null;

  const maxAge = parseHstsMaxAge();
  if (maxAge <= 0) return null;

  const directives = [`max-age=${maxAge}`];
  if (isEnvEnabled(process.env.HSTS_INCLUDE_SUBDOMAINS)) {
    directives.push('includeSubDomains');
  }
  return directives.join('; ');
};

/**
 * リクエストごとに評価する必要があるセキュリティヘッダを組み立てる。
 * 環境に依存しない静的ヘッダ（X-Frame-Options など）は next.config.ts 側で付与する。
 */
export const buildRuntimeSecurityHeaders = (
  requestOrigin: string | null,
): Record<string, string> => {
  const reporting = resolveCspReporting(requestOrigin);
  const headers: Record<string, string> = {
    'Content-Security-Policy-Report-Only': buildContentSecurityPolicy(reporting),
  };

  const strictTransportSecurity = buildStrictTransportSecurity();
  if (strictTransportSecurity) {
    headers['Strict-Transport-Security'] = strictTransportSecurity;
  }

  if (reporting.reportToUrl) {
    headers['Reporting-Endpoints'] = `${CSP_REPORT_ENDPOINT_GROUP}="${reporting.reportToUrl}"`;
  }

  return headers;
};
