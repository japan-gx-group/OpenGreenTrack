// 活動量の帳票の保存（POST）。POST /api/activity-evidence/upload-url で発行した URL に上げたファイルのパスを受け取り、
// 中身（先頭のバイト・大きさ）を確かめてから帳票として保存する。本体は features/activity-evidence/services/evidenceServer.ts。
//
// 全メンバーが呼べる。service_role で RLS を越えるため、受け取ったパスがログイン中の組織向けに発行した形かを
// Storage に触れる前に確かめる（他組織のパスなら、他人のファイルかもしれないので消しもしない）。

import { NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/currentProfile';
import { SIGNED_OUT_MESSAGE } from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestLogger } from '@/lib/logging/requestLogger';
import {
  finalizeEvidenceUpload,
  isEvidenceUploadPathForOrganization,
} from '@/features/activity-evidence/services/evidenceServer';

export const runtime = 'nodejs';

const CONVERTIBLE = ['image/png', 'image/jpeg'] as const;

export const POST = async (request: Request) => {
  const log = await getRequestLogger();
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const { storagePath, fileName, convertedFrom } = (typeof body === 'object' && body !== null ? body : {}) as Record<
    string,
    unknown
  >;
  if (typeof storagePath !== 'string' || !isEvidenceUploadPathForOrganization(storagePath, profile.organizationId)) {
    return NextResponse.json({ error: 'アップロード先の指定が不正です' }, { status: 400 });
  }
  if (typeof fileName !== 'string' || fileName.trim() === '') {
    return NextResponse.json({ error: 'fileName（帳票のファイル名）が必要です' }, { status: 400 });
  }
  const converted =
    typeof convertedFrom === 'string' && (CONVERTIBLE as readonly string[]).includes(convertedFrom)
      ? (convertedFrom as (typeof CONVERTIBLE)[number])
      : null;

  const result = await finalizeEvidenceUpload({
    admin: createAdminClient(),
    caller: profile,
    storagePath,
    fileName,
    convertedFrom: converted,
    log,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status });
  }
  return NextResponse.json(result.file, { status: 201 });
};
