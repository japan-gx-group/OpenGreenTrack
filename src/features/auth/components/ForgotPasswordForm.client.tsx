'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { Mail, MailCheck, ArrowLeft, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';

// パスワード再設定のリクエストフォーム。入力されたメールアドレス宛に再設定メールを送る。
// メールのリンクは /auth/callback で recovery セッションを確立し、/reset-password
// （新パスワード入力）へ遷移する。
export const ForgotPasswordForm = () => {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 送信完了後は入力フォームごと完了表示に切り替え、「送った」ことを明確に伝える。
  const [isSent, setIsSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`,
    });

    if (error) {
      setErrorMessage(error.message);
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
    setIsSent(true);
  };

  if (isSent) {
    return (
      <AuthFormFrame>
        <div className="flex flex-col">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-subtle text-primary">
            <MailCheck size={24} strokeWidth={1.8} />
          </span>
          {/* 画面全体の切り替えは視覚がないと気づけないため、送信完了をスクリーンリーダーへ通知する */}
          <div role="status">
            <h1 className="mt-5 font-serif text-[30px] font-semibold tracking-[0.2px]">
              メールを送信しました
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-text-subtle">
              <span className="font-medium text-text-heading">{email}</span>{' '}
              が登録済みであれば、パスワード再設定用のメールが届きます。
              メール内のリンクから新しいパスワードを設定してください。
            </p>
            <p className="mt-3 text-xs leading-relaxed text-text-muted">
              メールが届かない場合は、迷惑メールフォルダの確認と、メールアドレスに誤りがないかの確認をお願いします。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              // 文言どおり「別のアドレス」を入力し直す前提のため、前回の入力は残さない
              setIsSent(false);
              setEmail('');
            }}
            className="mt-6 text-left text-[13px] font-medium text-primary transition-colors hover:text-success"
          >
            別のメールアドレスで再送信する
          </button>
          <Link
            href="/login"
            className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary px-4 py-[15px] text-[15px] font-semibold text-primary-contrast transition-colors hover:bg-primary-dark"
          >
            ログイン画面へ戻る
          </Link>
        </div>
      </AuthFormFrame>
    );
  }

  return (
    <AuthFormFrame>
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">
          Forgot password
        </div>
        <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">
          パスワードの再設定
        </h1>
        <p className="mb-8 mt-2.5 text-sm leading-relaxed text-text-subtle">
          登録済みのメールアドレスを入力してください。パスワード再設定用のリンクをメールでお送りします。
        </p>

        <AuthField
          label="メールアドレス"
          htmlFor="forgot-password-email"
          icon={<Mail size={17} strokeWidth={1.8} />}
        >
          <input
            id="forgot-password-email"
            className={bareInputClass}
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@company.co.jp"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </AuthField>

        {errorMessage && (
          <p className="mt-5 text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary px-4 py-[15px] text-[15px] font-semibold text-primary-contrast transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {isSubmitting ? '送信中' : '再設定メールを送信'}
          {!isSubmitting && <ArrowRight size={17} strokeWidth={2.2} />}
        </button>

        <Link
          href="/login"
          className="mt-6 inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-text-subtle transition-colors hover:text-text-heading"
        >
          <ArrowLeft size={15} strokeWidth={2} />
          ログイン画面へ戻る
        </Link>
      </form>
    </AuthFormFrame>
  );
};
