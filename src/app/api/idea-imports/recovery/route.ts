// IDEA 取込の滞留回収（POST）。docs/idea-scope3-spec.md §4.1。
//
// 取込本体は取込 API の応答後にバックグラウンドで実行される。その途中でプロセスが止まると
// （開発サーバーの再起動・デプロイ・ホスティングの実行時間上限など）、idea_imports 行を
// completed / failed に書き換える処理が実行されず processing のまま残る。
// 回収処理（recoverStaleIdeaImports: 10 分以上更新の無い processing 行を failed に戻す）は取込の開始操作
// （upload-url / 取込 API）の中でも呼ばれるが、画面は processing の間それらの操作を受け付けないため、
// 取込中の表示から抜け出せなくなる。係数管理画面の IDEA データベースカードが取込中の間これを呼び、
// 中断された取込を画面からも回収できるようにする。
//
// 認証ガード（/api/idea-imports と同方針）:
//   回収は service_role で RLS を越えて書き込むため、呼び出し元をここで検証する。
//   対象組織は body ではなくログイン中プロフィールから取る（他組織の取込を回収させない）。
//   ロールによる絞り込みは行わない（IDEA の取込はメンバーも行う）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { recoverStaleIdeaImports } from '@/features/factors/services/ideaImportServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

export const POST = async () => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  try {
    // 失敗は recoverStaleIdeaImports の中でログに残すだけで、ここへは投げない（回収できなくても取込状況の表示は続く）。
    await recoverStaleIdeaImports(createAdminClient(), profile.organizationId, log);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    log.error({ error }, '予期しないエラー');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
