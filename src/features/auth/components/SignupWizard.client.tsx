'use client';

// 初回登録ウィザード（初期セットアップ）。
// ①アカウント（氏名・メール・パスワード）→ ②企業情報 → ③拠点の初期登録 のステップ形式。
// 最後にサーバ（setupOrganization）で組織・admin・拠点・初年度をまとめて作り、
// 成功したらそのままクライアントでログインして /dashboard へ進む。

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import {
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Building2,
  Plus,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { setupOrganization } from '@/features/auth/services/setup';
import { getSafeRedirectPath } from '@/features/auth/utils/redirect';
import type { InitialLocationInput } from '@/features/auth/types';
import { REGIONS, REGION_LABELS, type Region } from '@/types/region';
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type LocationType,
} from '@/features/locations/types';
import { AuthFormFrame } from '@/features/auth/components/AuthFormFrame';
import { AuthField, bareInputClass } from '@/features/auth/components/AuthField';
import { isValidEmail } from '@/lib/email';

const STEPS = ['アカウント', '企業情報', '拠点の初期登録'] as const;

// フッター操作ボタンの共通スタイル（デザイン正のトーンに合わせた角丸緑 / アウトライン）。
const primaryBtnClass =
  'flex items-center justify-center gap-2 rounded-[11px] bg-primary px-5 py-3 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-dark disabled:opacity-60';
const outlineBtnClass =
  'flex items-center justify-center gap-2 rounded-[11px] border border-border bg-bg-card px-5 py-3 text-sm font-semibold text-text-heading transition-colors hover:bg-bg-subtle disabled:opacity-60';

const emptyLocation = (): InitialLocationInput => ({
  name: '',
  region: 'Kanto',
  type: 'office',
});

export const SignupWizard = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // React の state 更新は非同期なので、button の disabled だけでは同一tick内の
  // 二重クリックを防げない。ref を同期的に立てて多重送信を確実に止める。
  const submittingRef = useRef(false);

  // ①アカウント
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // ②企業情報
  const [organizationName, setOrganizationName] = useState('');

  // ③拠点（最低1件）
  const [locations, setLocations] = useState<InitialLocationInput[]>([emptyLocation()]);

  const updateLocation = (index: number, patch: Partial<InitialLocationInput>) => {
    setLocations((prev) =>
      prev.map((location, i) => (i === index ? { ...location, ...patch } : location)),
    );
  };
  const addLocation = () => setLocations((prev) => [...prev, emptyLocation()]);
  const removeLocation = (index: number) =>
    setLocations((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  // 各ステップの「次へ」を押せるかの検証。
  const validateStep = (): string => {
    if (step === 0) {
      if (!fullName.trim() || !email.trim() || !password) {
        return '氏名・メールアドレス・パスワードを入力してください';
      }
      // 「次へ」は type="button" なので input type="email" のブラウザ検証は効かない。ここで明示的に検証する。
      if (!isValidEmail(email)) {
        return 'メールアドレスの形式が正しくありません';
      }
      if (password.length < 8) {
        return 'パスワードは8文字以上で設定してください';
      }
    }
    if (step === 1) {
      if (!organizationName.trim()) {
        return '企業名を入力してください';
      }
    }
    if (step === 2) {
      const valid = locations.filter((l) => l.name.trim());
      if (valid.length === 0) {
        return '拠点を1つ以上、拠点名を入力してください';
      }
    }
    return '';
  };

  const goNext = () => {
    const message = validateStep();
    if (message) {
      setErrorMessage(message);
      return;
    }
    setErrorMessage('');
    setStep((prev) => Math.min(STEPS.length - 1, prev + 1));
  };

  const goBack = () => {
    setErrorMessage('');
    setStep((prev) => Math.max(0, prev - 1));
  };

  const handleSubmit = async () => {
    // 二重送信ガード（同一tickの多重クリックを止める。組織が重複作成される主トリガの防止）。
    if (submittingRef.current) {
      return;
    }

    const message = validateStep();
    if (message) {
      setErrorMessage(message);
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setErrorMessage('');

    // 送信を中断して再入力可能な状態に戻す（エラー表示＋ボタン再活性化）。
    const fail = (msg: string) => {
      setErrorMessage(msg);
      setIsSubmitting(false);
      submittingRef.current = false;
    };

    try {
      const result = await setupOrganization({
        fullName,
        email,
        password,
        organizationName,
        locations,
      });

      if (!result.ok) {
        fail(result.error);
        return;
      }

      // 作成したユーザーでそのままログインして遷移する。
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: result.data.email,
        password,
      });
      if (error) {
        // アカウントは作成済み。自動ログインに失敗した場合はログイン画面へ誘導する（画面遷移するので戻さない）。
        router.replace('/login');
        return;
      }

      router.replace(getSafeRedirectPath(searchParams.get('next')));
      router.refresh();
    } catch {
      // Server Action の reject（通信断など）でボタンが固まらないよう必ず戻す。
      fail('通信に失敗しました。時間をおいて再度お試しください');
    }
  };

  return (
    <AuthFormFrame maxWidthClass="max-w-[520px]">
      <div className="text-[11px] uppercase tracking-[0.16em] text-text-label">Initial setup</div>
      <h1 className="mt-2 font-serif text-[30px] font-semibold tracking-[0.2px]">初期セットアップ</h1>
      <p className="mt-2.5 text-sm leading-relaxed text-text-subtle">
        管理者アカウントと企業・拠点を作成します。この設定は最初の1回だけです。
      </p>

      {/* ステップインジケータ */}
      <div className="mt-7 flex gap-2">
        {STEPS.map((label, index) => {
          const active = index <= step;
          return (
            <div key={label} className="flex flex-1 flex-col gap-1.5">
              <span
                className={clsx(
                  'h-1 rounded-full transition-colors',
                  active ? 'bg-primary' : 'bg-bg-subtle',
                )}
              />
              <span
                className={clsx('text-xs', active ? 'font-medium text-primary' : 'text-text-subtle')}
              >
                {index + 1}. {label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-7">
        {/* ①アカウント */}
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <AuthField label="氏名" htmlFor="signup-name" icon={<User size={17} strokeWidth={1.8} />}>
              <input
                id="signup-name"
                className={bareInputClass}
                type="text"
                value={fullName}
                autoComplete="name"
                placeholder="例: 環境 太郎"
                onChange={(event) => setFullName(event.target.value)}
              />
            </AuthField>
            <AuthField
              label="メールアドレス"
              htmlFor="signup-email"
              icon={<Mail size={17} strokeWidth={1.8} />}
            >
              <input
                id="signup-email"
                className={bareInputClass}
                type="email"
                value={email}
                autoComplete="email"
                placeholder="you@company.co.jp"
                onChange={(event) => setEmail(event.target.value)}
              />
            </AuthField>
            <AuthField
              label="パスワード"
              htmlFor="signup-password"
              icon={<Lock size={17} strokeWidth={1.8} />}
              hint="8文字以上で設定してください"
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
                id="signup-password"
                className={bareInputClass}
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="new-password"
                placeholder="••••••••"
                onChange={(event) => setPassword(event.target.value)}
              />
            </AuthField>
          </div>
        )}

        {/* ②企業情報 */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <AuthField
              label="企業名"
              htmlFor="signup-org"
              icon={<Building2 size={17} strokeWidth={1.8} />}
            >
              <input
                id="signup-org"
                className={bareInputClass}
                type="text"
                value={organizationName}
                autoComplete="organization"
                placeholder="例: サンプル株式会社"
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </AuthField>
          </div>
        )}

        {/* ③拠点の初期登録 */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-text-subtle">
              排出量を集計する拠点を登録します（後から拠点管理画面で追加・編集できます）。
            </p>
            {locations.map((location, index) => (
              <div
                key={index}
                className="flex flex-col gap-4 rounded-[14px] border border-border bg-bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text-heading">拠点 {index + 1}</span>
                  {locations.length > 1 && (
                    <button
                      type="button"
                      className="text-xs font-medium text-danger hover:underline"
                      onClick={() => removeLocation(index)}
                    >
                      削除
                    </button>
                  )}
                </div>
                <AuthField label="拠点名" htmlFor={`loc-name-${index}`}>
                  <input
                    id={`loc-name-${index}`}
                    className={bareInputClass}
                    type="text"
                    value={location.name}
                    placeholder="例: 東京本社"
                    onChange={(event) => updateLocation(index, { name: event.target.value })}
                  />
                </AuthField>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <AuthField label="地域" htmlFor={`loc-region-${index}`}>
                    <select
                      id={`loc-region-${index}`}
                      className={bareInputClass}
                      value={location.region}
                      onChange={(event) =>
                        updateLocation(index, { region: event.target.value as Region })
                      }
                    >
                      {REGIONS.map((region) => (
                        <option key={region} value={region}>
                          {REGION_LABELS[region]}
                        </option>
                      ))}
                    </select>
                  </AuthField>
                  <AuthField label="拠点種別" htmlFor={`loc-type-${index}`}>
                    <select
                      id={`loc-type-${index}`}
                      className={bareInputClass}
                      value={location.type}
                      onChange={(event) =>
                        updateLocation(index, { type: event.target.value as LocationType })
                      }
                    >
                      {LOCATION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {LOCATION_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </AuthField>
                </div>
              </div>
            ))}
            <button type="button" className={clsx(outlineBtnClass, 'w-full')} onClick={addLocation}>
              <Plus size={16} strokeWidth={2} />
              拠点を追加
            </button>
          </div>
        )}
      </div>

      {errorMessage && (
        <p className="mt-5 text-sm text-danger" role="alert">
          {errorMessage}
        </p>
      )}

      {/* フッター操作 */}
      <div className="mt-7 flex items-center justify-between">
        {step > 0 ? (
          <button type="button" className={outlineBtnClass} onClick={goBack} disabled={isSubmitting}>
            <ArrowLeft size={16} strokeWidth={2} />
            戻る
          </button>
        ) : (
          <span />
        )}

        {step < STEPS.length - 1 ? (
          <button type="button" className={primaryBtnClass} onClick={goNext}>
            次へ
            <ArrowRight size={16} strokeWidth={2.2} />
          </button>
        ) : (
          <button
            type="button"
            className={primaryBtnClass}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? '作成中' : 'セットアップを完了'}
            {!isSubmitting && <ArrowRight size={16} strokeWidth={2.2} />}
          </button>
        )}
      </div>

      <p className="mt-7 text-xs text-text-muted">
        既にアカウントをお持ちの方は{' '}
        <Link href="/login" className="font-medium text-primary hover:text-success">
          ログイン
        </Link>
      </p>
    </AuthFormFrame>
  );
};
