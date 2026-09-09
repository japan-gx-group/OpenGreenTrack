'use client';

import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';
import { completePasswordRecovery } from '@/features/auth/services/passwordRecovery';

const MIN_PASSWORD_LENGTH = 8;

// パスワード再設定の完了ページ。/auth/callback で recovery セッションが確立済みの前提で開かれ、
// Server Action（completePasswordRecovery）で新しいパスワードを設定する。ブラウザからの
// auth.updateUser は secure_password_change 有効時に拒否されるため、更新はサーバで行う。
// セッションが無い（リンク切れ・直接アクセス）場合は案内を出してログインへ戻す。
export const ResetPasswordForm = () => {
  const router = useRouter();
  // recovery セッションの有無を確認するまではローディング表示にする。
  const [sessionState, setSessionState] = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    // 再設定リンク経由なら /auth/callback で認証セッション Cookie（@supabase/ssr の
    // sb-<ref>-auth-token）が確立済み。この Cookie の有無だけを直接見て判定する。
    // getSession()/getUser() は navigator.locks を取得するため、別タブ等でロックが
    // 競合するとハングし得る（無限スピナー化）。Cookie 判定なら同期・ロック非依存で確実。
    // 判定は setTimeout(0) 経由で反映する（effect 本体での同期 setState を禁じる
    // react-hooks/set-state-in-effect 対応。Locations.tsx と同じ方針）。
    const timer = setTimeout(() => {
      if (!active) return;
      const hasAuthCookie = document.cookie
        .split('; ')
        .some((c) => /^sb-.+-auth-token(\.\d+)?=/.test(c));
      setSessionState(hasAuthCookie ? 'ready' : 'invalid');
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(`パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください。`);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('確認用パスワードが一致しません。');
      return;
    }

    setIsSubmitting(true);
    const result = await completePasswordRecovery(password);

    if (!result.ok) {
      setErrorMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    // 再設定後は recovery セッションを破棄し、新パスワードで改めてログインしてもらう。
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login?reset=success');
  };

  if (sessionState === 'checking') {
    return (
      <AuthFormFrame>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 size={16} className="animate-spin" />
          リンクを確認しています…
        </div>
      </AuthFormFrame>
    );
  }

  if (sessionState === 'invalid') {
    return (
      <AuthFormFrame>
        <div className="flex flex-col">
          <h1 className="font-serif text-[30px] font-semibold tracking-[0.2px]">リンクが無効です</h1>
          <p className="mb-8 mt-2.5 text-sm leading-relaxed text-text-subtle">
            パスワード再設定リンクの有効期限が切れているか、既に使用済みの可能性があります。
            お手数ですが、ログイン画面から再度お試しください。
          </p>
          <Link
            href="/login"
            className="flex w-full items-center justify-center gap-2.5 rounded-[11px] bg-primary px-4 py-[15px] text-[15px] font-semibold text-primary-contrast transition-colors hover:bg-primary-dark"
          >
            ログイン画面へ
            <ArrowRight size={17} strokeWidth={2.2} />
          </Link>
        </div>
      </AuthFormFrame>
    );
  }

  return (
    <AuthFormFrame>
      <form onSubmit={handleSubmit} className="flex flex-col">
        <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Reset password</div>
        <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">
          新しいパスワードの設定
        </h1>
        <p className="mb-8 mt-2.5 text-sm leading-relaxed text-text-subtle">
          新しいパスワードを入力してください（{MIN_PASSWORD_LENGTH}文字以上）。
        </p>

        <div className="flex flex-col gap-5">
          <AuthField
            label="新しいパスワード"
            htmlFor="reset-password"
            icon={<Lock size={17} strokeWidth={1.8} />}
            adornment={
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                className="flex shrink-0 p-1 text-text-label transition-colors hover:text-text-muted"
              >
                {showPassword ? (
                  <EyeOff size={18} strokeWidth={1.8} />
                ) : (
                  <Eye size={18} strokeWidth={1.8} />
                )}
              </button>
            }
          >
            <input
              id="reset-password"
              className={bareInputClass}
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete="new-password"
              placeholder="••••••••"
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </AuthField>

          <AuthField
            label="新しいパスワード（確認）"
            htmlFor="reset-password-confirm"
            icon={<Lock size={17} strokeWidth={1.8} />}
          >
            <input
              id="reset-password-confirm"
              className={bareInputClass}
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              autoComplete="new-password"
              placeholder="••••••••"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </AuthField>
        </div>

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
          {isSubmitting ? '設定中' : 'パスワードを更新'}
          {!isSubmitting && <ArrowRight size={17} strokeWidth={2.2} />}
        </button>
      </form>
    </AuthFormFrame>
  );
};
