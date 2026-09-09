import { Suspense } from 'react';
import { getInviteForToken } from '@/features/auth/services/invites';
import { InviteForm } from '@/features/auth/components/InviteForm.client';

// admin client（service_role）でトークンを検証するため、ビルド時の事前生成を避けて
// 常にリクエスト時に実行する。
export const dynamic = 'force-dynamic';

// 招待リンクを開いて登録する画面。トークンの検証はサーバで行い、結果をフォームへ渡す。
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getInviteForToken(token);
  // InviteForm は useSearchParams() を使うため Suspense 境界で包む。
  return (
    <Suspense>
      <InviteForm token={token} result={result} />
    </Suspense>
  );
}
