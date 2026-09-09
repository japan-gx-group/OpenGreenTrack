// ダッシュボード集計（dashboard_aggregates）の再計算トリガー。
// docs/idea-scope3-spec.md §5.1: 算定バッチ以外にも次のタイミングで集計を
// 最新化する必要がある: ①Scope3カテゴリの方式切替時 ②Scope3直接入力値の upsert 時
// ③活動量レコード（Scope3積上げを含む）の削除時（削除後の集計更新はレート制限のある
//   /api/calculations を経由せず、データ入力画面からこの Route を直接呼ぶ）。
// refresh_dashboard_aggregates の EXECUTE は service_role 限定
// （supabase/migrations/20260831000002_rpc.sql）のため、
// ここで認証＋自組織検証を行ったうえで管理クライアントから呼び出す。
//
// 認証ガード（/api/calculations と同方針）:
//   ログイン済みユーザーのみ・自組織の会計年度のみ許可する。RLS を越える経路のため、
//   組織チェック（下の organizationId 比較）はここでしか担保できない。消さないこと。

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）
export const runtime = 'nodejs';

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'リクエストボディが不正なJSONです' }, { status: 400 });
  }

  const { fiscalYearId } = (body ?? {}) as { fiscalYearId?: unknown };
  if (typeof fiscalYearId !== 'string' || fiscalYearId === '') {
    return NextResponse.json({ error: 'fiscalYearId（文字列）が必要です' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    // 対象年度の存在と所属組織を確認する（他組織の年度IDを渡した再集計を拒否する）。
    const { data: fiscalYear, error: fiscalYearError } = await supabase
      .from('fiscal_years')
      .select('id, organizationId')
      .eq('id', fiscalYearId)
      .maybeSingle();

    if (fiscalYearError) {
      // UUID 形式でない fiscalYearId（22P02）は「存在しない年度」として扱う。
      if (fiscalYearError.code === '22P02') {
        return NextResponse.json({ error: '算定年度が見つかりません' }, { status: 404 });
      }
      log.error({ error: fiscalYearError, fiscalYearId }, '会計年度の取得に失敗');
      return NextResponse.json({ error: '算定年度の確認に失敗しました' }, { status: 500 });
    }
    if (!fiscalYear) {
      return NextResponse.json({ error: '算定年度が見つかりません' }, { status: 404 });
    }
    if (fiscalYear.organizationId !== profile.organizationId) {
      return NextResponse.json(
        { error: '自組織以外の集計は更新できません' },
        { status: 403 },
      );
    }

    const { error: rpcError } = await supabase.rpc('refresh_dashboard_aggregates', {
      p_organization_id: profile.organizationId,
      p_fiscal_year_id: fiscalYearId,
    });
    if (rpcError) {
      // 生の DB エラーを呼び出し元へ返さないよう、詳細はサーバーログにのみ残す。
      log.error({ error: rpcError, fiscalYearId }, 'ダッシュボード集計の再計算に失敗');
      return NextResponse.json(
        { error: 'ダッシュボード集計の更新に失敗しました' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error({ error, fiscalYearId }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
