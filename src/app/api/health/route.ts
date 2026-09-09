// ヘルスチェックエンドポイント。ホスト側の死活監視やデプロイの readiness probe に使う。
// Supabase への接続を検証し、アプリケーションの正常性を返す。
//
// 未認証で叩かれる前提のエンドポイント（proxy.ts の matcher で除外済み）。
//
// service_role クライアントを使う理由: RLS ポリシーはすべて `to authenticated` で、
// anon ロールにはどのテーブルにも読み取り権が無い。anon で叩くと DB が正常でも
// 「permission denied」が返り、疎通の可否を判定できないため。
// 公開経路だが、レスポンスに載せるのは ok / error の2値だけで、DB のエラーメッセージや
// 行データは一切返さない（詳細はサーバーログにのみ残す）。キーもサーバ内に閉じている。
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async () => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let healthy = true;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('organizations').select('id').limit(1);
    checks.database = error ? 'error' : 'ok';
    if (error) {
      healthy = false;
      logger.error({ error }, 'ヘルスチェック: データベース接続エラー');
    }
  } catch (error) {
    checks.database = 'error';
    healthy = false;
    logger.error({ error }, 'ヘルスチェック: データベース接続エラー');
  }

  return NextResponse.json(
    { status: healthy ? 'healthy' : 'unhealthy', timestamp: new Date().toISOString(), checks },
    { status: healthy ? 200 : 503 },
  );
};
