import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm.client';

// パスワード再設定メールの送信リクエストページ。ログイン画面の
// 「パスワードをお忘れですか？」から遷移し、メールアドレス入力→送信→完了表示を行う。
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
