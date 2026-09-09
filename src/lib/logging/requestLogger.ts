// リクエストごとのコンテキスト（requestId / organizationId / userId）付きロガー。
// API Route / Server Action の冒頭で呼び、以降の処理（background job を含む）に渡す。
// child logger により全ログ行に requestId が付き、1リクエストのログを横断的に追跡できる。
import { headers } from 'next/headers';
import { logger } from './logger';
import { getCurrentProfile } from '@/lib/currentProfile';
import type { Logger } from 'pino';

export type RequestLogger = Logger;

export const getRequestLogger = async (): Promise<RequestLogger> => {
  const h = await headers();
  const requestId = h.get('x-request-id') || crypto.randomUUID();

  // getCurrentProfile が失敗してもロガーは返す（未認証リクエストでも使えるように）
  let orgId: string | undefined;
  let userId: string | undefined;
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      orgId = profile.organizationId;
      userId = profile.id;
    }
  } catch {
    // ignore — profile resolution failure shouldn't block logging
  }

  return logger.child({
    requestId,
    ...(orgId && { organizationId: orgId }),
    ...(userId && { userId }),
  });
};
