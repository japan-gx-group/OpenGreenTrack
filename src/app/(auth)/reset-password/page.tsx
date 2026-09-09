import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm.client';

// パスワード再設定の完了ページ。/auth/callback で recovery セッションを確立したうえで開かれる。
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
