import type { NextConfig } from 'next';

// ここで返すヘッダは `next build` 時に一度だけ評価され .next/routes-manifest.json に固定される。
// そのため環境変数に依存しない静的なヘッダだけを置く。実行時の環境変数から導出するヘッダ
// （CSP / Reporting-Endpoints / HSTS）は src/lib/security/securityHeaders.ts で組み立て、
// リクエストごとに評価される src/proxy.ts から付与する。
const STATIC_SECURITY_HEADERS = [
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  },
];

const nextConfig: NextConfig = {
  // 設定を追加する場合は AGENTS.md の規約に従うこと

  // pino / pino-pretty はサーバ専用のため、バンドルせず Node の実行時解決に任せる。
  serverExternalPackages: ['pino', 'pino-pretty'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: STATIC_SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
