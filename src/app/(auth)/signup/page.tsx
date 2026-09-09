import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSetupState } from '@/features/auth/services/setup';
import { SignupWizard } from '@/features/auth/components/SignupWizard.client';

// admin client（service_role）で組織有無を確認するため、ビルド時の事前生成を避けて
// 常にリクエスト時に実行する。
export const dynamic = 'force-dynamic';

// 初回登録ウィザード（初期セットアップ）。
// 自社ホスト・単一テナント前提のため、既にセットアップ済み（組織が存在する）なら
// このページは開かせず /login へ送る。
export default async function SignupPage() {
  const setupState = await getSetupState();
  if (setupState === 'completed') {
    redirect('/login?setup=done');
  }
  // 判定できなかった場合もウィザードは開かせないが、「セットアップ済み」と同じ案内にすると
  // 環境側の異常（接続設定の誤りなど）が誰にも気づかれないため、別の案内へ送る。
  if (setupState === 'unknown') {
    redirect('/login?setup=error');
  }
  // SignupWizard は useSearchParams() を使うため Suspense 境界で包む。
  return (
    <Suspense>
      <SignupWizard />
    </Suspense>
  );
}
