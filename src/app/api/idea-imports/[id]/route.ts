// IDEA インポートの削除 API（docs/idea-scope3-spec.md §3.6-4）。
// emission_results から参照されている間は削除を拒否する。参照チェックと削除の原子性は
// service_role 限定の RPC delete_idea_import（supabase/migrations/20260831000002_rpc.sql）が保証する。
//
// 認証ガード: ログイン済みユーザーの自組織のインポートのみ削除できる
// （組織スコープは RPC 引数 p_organization_id で強制。ロール判定はしない）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { IDEA_IMPORT_SQLSTATE } from '@/features/factors/services/ideaImportServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const { id } = await params;
  // UUID 以外は RPC まで行かずに 404 相当で返す（DB エラー経由にしない）。
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: '対象のインポートが見つかりません' }, { status: 404 });
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.rpc('delete_idea_import', {
      p_import_id: id,
      p_organization_id: profile.organizationId,
    });

    if (error) {
      if (error.code === IDEA_IMPORT_SQLSTATE.importInvalid) {
        return NextResponse.json({ error: '対象のインポートが見つかりません' }, { status: 404 });
      }
      if (error.code === IDEA_IMPORT_SQLSTATE.importReferenced) {
        // §3.6-4: 算定結果が参照している間は削除不可（isActive=false での運用無効化は可能）
        return NextResponse.json(
          { error: '算定結果から参照されているため削除できません。算定結果ごと削除する場合は、対象の活動量レコードを先に削除してください' },
          { status: 409 },
        );
      }
      log.error({ error, importId: id }, 'インポートの削除に失敗しました');
      return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error({ error, importId: id }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
