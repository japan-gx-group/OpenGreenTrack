// 会計年度への IDEA の版の割り当て（docs/idea-scope3-spec.md §3.6-5）。
// body: { fiscalYearId: string, importId: string | null }（null は割り当てを外し、その年度は有効な版に戻る）。
// 割り当てと同時に、その年度の未算定の活動量を割り当てた版（外したときは有効な版）へ ideaCode 一致で付け替える
// （service_role 限定の RPC assign_idea_import_to_fiscal_year が 1 トランザクションで行う）。
//
// 認証ガード（/api/idea-imports と同方針）:
//   RPC は service_role で RLS を越えて書き込むため、呼び出し元をここで検証する。
//   対象組織は body ではなくログイン中プロフィールから取る（他組織の年度・版は RPC が組織の突き合わせで拒否する）。
//   ロールによる絞り込みは行わない（IDEA の取込はメンバーも行う）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { IDEA_IMPORT_SQLSTATE } from '@/features/factors/services/ideaImportServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const { fiscalYearId, importId } = (body ?? {}) as { fiscalYearId?: unknown; importId?: unknown };
  if (typeof fiscalYearId !== 'string' || !UUID_PATTERN.test(fiscalYearId)) {
    return NextResponse.json({ error: 'fiscalYearId（会計年度のID）が必要です' }, { status: 400 });
  }
  if (importId !== null && (typeof importId !== 'string' || !UUID_PATTERN.test(importId))) {
    return NextResponse.json({ error: 'importId（版のID。割り当てを外すときは null）が必要です' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('assign_idea_import_to_fiscal_year', {
      p_organization_id: profile.organizationId,
      p_fiscal_year_id: fiscalYearId,
      p_import_id: importId,
      p_user_id: profile.id,
    });

    if (error) {
      if (error.code === IDEA_IMPORT_SQLSTATE.fiscalYearInvalid) {
        return NextResponse.json({ error: '会計年度が見つかりません' }, { status: 404 });
      }
      if (error.code === IDEA_IMPORT_SQLSTATE.importInvalid) {
        return NextResponse.json({ error: '取込が完了した版が見つかりません' }, { status: 404 });
      }
      log.error({ error, fiscalYearId, importId }, '会計年度への版の割り当てに失敗しました');
      return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
    }

    const result = (data ?? {}) as { importId?: string | null; remappedCount?: number; unmappedCount?: number };
    return NextResponse.json({
      importId: result.importId ?? null,
      remappedCount: result.remappedCount ?? 0,
      unmappedCount: result.unmappedCount ?? 0,
    });
  } catch (error) {
    log.error({ error, fiscalYearId, importId }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
