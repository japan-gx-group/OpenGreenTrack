// 活動量の帳票の削除（DELETE）。どの記録にも紐づいていない帳票だけを、Storage のファイルと一緒に消す。
// 全メンバーが呼べる（帳票の削除は全員に許す）。service_role で消すため、帳票がログイン中の組織のものかを確かめる。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { SIGNED_OUT_MESSAGE } from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import { deleteEvidenceFile } from '@/features/activity-evidence/services/evidenceServer';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DELETE = async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });
  }
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: '帳票が見つかりません' }, { status: 404 });
  }

  const result = await deleteEvidenceFile({ admin: createAdminClient(), caller: profile, id, log });
  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status });
  }
  return new NextResponse(null, { status: 204 });
};
