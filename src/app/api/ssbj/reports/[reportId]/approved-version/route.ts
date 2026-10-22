// SSBJ レポートの承認した保存版の、開示する内容だけを返す API（docs/authorization-matrix.md §2.3）。
// 閲覧者は保存版の行を RLS で読めない（内部メモ・内部記録を含むため）。この API が service_role で読み、
// 内部メモ・内部記録を除いてから返す（services/approvedVersionServer.ts・utils/disclosedSnapshot.ts）。
//
// 認証ガード: ログイン済みユーザーの自組織のレポートだけを返す（組織は getCurrentProfile から確定する）。
// どの SSBJ のロールでも読める（承認した版の開示する内容は閲覧者にも見せる）。他組織・存在しない・承認済みでない・
// 承認した版が無いレポートは区別せず 404。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { fetchSsbjApprovedVersion } from '@/features/ssbj/services/approvedVersionServer';
import { guardSsbjRole } from '@/features/ssbj/services/roleServer';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = '承認した保存版が見つかりません';

export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const { reportId } = await params;
  if (!UUID_PATTERN.test(reportId)) {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  // SSBJ のロールの確認（docs/authorization-matrix.md §2.2）。service_role の処理は RLS を越えるので、ここで確かめる。
  const denial = await guardSsbjRole(profile, 'view_approved', error => log.error({ error, reportId }, 'SSBJ のロールの確認に失敗しました'));
  if (denial) {
    return NextResponse.json({ error: denial.error }, { status: denial.status });
  }

  try {
    const result = await fetchSsbjApprovedVersion({ reportId, organizationId: profile.organizationId });
    if (!result) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    if (result.unclassifiedPaths.length > 0) {
      // 分類していない項目は返さずに進める（閲覧者に出さない側に倒す）。分類の足し忘れなので記録する。
      log.warn({ reportId, paths: result.unclassifiedPaths }, 'SSBJ の保存版に、開示するか決めていない項目があります（返さずに除きました）');
    }
    return NextResponse.json(result.version, { status: 200 });
  } catch (error) {
    log.error({ error, reportId }, 'SSBJ の承認した保存版の取得に失敗しました');
    return NextResponse.json({ error: 'サーバー内部エラーが発生しました' }, { status: 500 });
  }
};
