import { NextResponse } from 'next/server';
import {
  consumeCspReportQuota,
  isAllowedCspReportContentType,
  parseCspReports,
  RATE_LIMIT_WINDOW_SECONDS,
  readLimitedBody,
} from '@/lib/security/cspReport';
import { logger } from '@/lib/logging/logger';

// レポート送信元は「違反が起きたページのオリジン」で、認証情報も乗らない。
// 通常は同一オリジンで届くが、複数ホスト名で配信している構成ではクロスオリジンになり
// プリフライトが飛ぶため、405 で落として全レポートを失わないよう OPTIONS も返す。
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};
const RESPONSE_HEADERS = { 'Cache-Control': 'no-store', ...CORS_HEADERS };

const errorResponse = (error: string, status: number, headers: HeadersInit = RESPONSE_HEADERS) =>
  NextResponse.json({ error }, { status, headers });

export const POST = async (request: Request) => {
  if (!consumeCspReportQuota(request)) {
    return errorResponse('Too many CSP reports', 429, {
      ...RESPONSE_HEADERS,
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS),
    });
  }

  if (!isAllowedCspReportContentType(request)) {
    return errorResponse('Unsupported CSP report content type', 415);
  }

  const body = await readLimitedBody(request);
  if (!body.ok) {
    return errorResponse(body.error, body.status);
  }

  const reports = parseCspReports(body.text);
  if (!reports) {
    return errorResponse('Invalid CSP report JSON', 400);
  }

  // 未認証で到達できるルートなので、レポート本文はログに出す前に
  // 許可リストとサニタイズを通してある（src/lib/security/cspReport.ts）。
  reports.forEach((report) => {
    logger.warn({ cspReport: report }, 'CSP違反レポートを受信しました');
  });

  return new NextResponse(null, { status: 204, headers: RESPONSE_HEADERS });
};

export const OPTIONS = async () =>
  new NextResponse(null, { status: 204, headers: RESPONSE_HEADERS });
