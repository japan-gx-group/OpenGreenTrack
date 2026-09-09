'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/Modal.client';
import { PageHeading } from '@/components/layout/PageHeading';
import {
  User,
  Shield,
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import type { CurrentProfile } from '../types';
import { getCurrentProfile, updateProfile, updatePassword, deleteAccount } from '../services/profileService';

export const AccountSettings = () => {
  const router = useRouter();

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // 前のトーストの消去タイマーが後から表示したトーストを早期に消さないよう、表示のたびにキャンセルする。
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  // 1. プロフィール
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ fullName: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  // 2. パスワード
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', new: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  // 3. 退会
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    getCurrentProfile()
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch((error: unknown) => {
        if (active) {
          showToast(
            error instanceof Error ? error.message : 'プロフィールの取得に失敗しました',
            'error',
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const startEditingProfile = () => {
    if (!profile) return;
    setProfileForm({ fullName: profile.fullName, phone: profile.phone });
    setIsEditingProfile(true);
  };

  const handleProfileSave = async () => {
    if (!profile) return;
    setSavingProfile(true);
    try {
      await updateProfile(profileForm);
      setProfile({ ...profile, fullName: profileForm.fullName.trim(), phone: profileForm.phone.trim() });
      setIsEditingProfile(false);
      showToast('プロフィールを保存しました', 'success');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : '保存に失敗しました', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const closePasswordModal = () => {
    setIsPasswordModalOpen(false);
    setPasswordForm({ current: '', new: '', confirm: '' });
    setShowPassword(false);
  };

  const handlePasswordSave = async () => {
    if (passwordForm.new !== passwordForm.confirm) {
      showToast('新しいパスワードが一致しません。', 'error');
      return;
    }
    if (passwordForm.new.length < 8) {
      showToast('パスワードは8文字以上である必要があります。', 'error');
      return;
    }

    setSavingPassword(true);
    try {
      await updatePassword({
        currentPassword: passwordForm.current,
        newPassword: passwordForm.new,
      });
      closePasswordModal();
      showToast('パスワードを更新しました', 'success');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'パスワードの更新に失敗しました', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccount();
      // セッションは deleteAccount 内でサインアウト済み。ログイン画面へ遷移する。
      router.replace('/login');
      router.refresh();
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'アカウントの削除に失敗しました', 'error');
      setDeleting(false);
    }
  };

  return (
    <>
      {/* 年度別のデータを扱わない画面のため、ヘッダーの年度セレクタは出さない。 */}
      <div className="page-content gt-scroll max-w-[900px] mx-auto pb-12">
        <PageHeading
          title="アカウント設定"
          description="プロフィールとログイン情報の管理"
          showFiscalYear={false}
          primaryAction={null}
        />
        <div className="flex flex-col" style={{ gap: '14px' }}>
        {/* --- 1. プロフィール --- */}
        <Card className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">
              <User size={18} className="text-primary" />
              プロフィール詳細
            </h2>
            {!loading && profile && (
              isEditingProfile ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="gt-btn text-xs"
                    onClick={() => setIsEditingProfile(false)}
                    disabled={savingProfile}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    className="gt-btn-primary text-xs"
                    onClick={handleProfileSave}
                    disabled={savingProfile}
                  >
                    {savingProfile ? '保存中...' : '変更を保存'}
                  </button>
                </div>
              ) : (
                <button type="button" className="gt-btn text-xs" onClick={startEditingProfile}>
                  情報を編集
                </button>
              )
            )}
          </div>
          <hr className="border-border" />

          {loading ? (
            <p className="text-sm text-text-muted py-2">読み込み中...</p>
          ) : (
            <div>
              <div className="flex items-center mb-3 gap-4">
                <label htmlFor="profile-name" className="w-[140px] font-semibold text-text-muted shrink-0">
                  氏名:
                </label>
                {isEditingProfile ? (
                  <input
                    id="profile-name"
                    className="gt-field max-w-[300px]"
                    value={profileForm.fullName}
                    onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
                  />
                ) : (
                  <span className="font-medium text-text-main">{profile?.fullName || '—'}</span>
                )}
              </div>
              <div className="flex items-center mb-3 gap-4">
                <label className="w-[140px] font-semibold text-text-muted shrink-0">
                  メールアドレス:
                </label>
                {/* メール変更は再確認メールの往復が必要なため本画面では表示のみ（変更不可）。 */}
                <span className="font-medium text-text-main">{profile?.email}</span>
              </div>
              <div className="flex items-center mb-3 gap-4">
                <label htmlFor="profile-phone" className="w-[140px] font-semibold text-text-muted shrink-0">
                  電話番号:
                </label>
                {isEditingProfile ? (
                  <input
                    id="profile-phone"
                    type="tel"
                    className="gt-field max-w-[300px]"
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  />
                ) : (
                  <span className="font-medium text-text-main">{profile?.phone || '—'}</span>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* --- 2. セキュリティ --- */}
        <Card className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="font-serif font-semibold text-lg text-text-heading flex items-center gap-2">
              <Shield size={18} className="text-primary" />
              セキュリティとアクセス
            </h2>
          </div>
          <hr className="border-border" />
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <span className="w-[140px] font-semibold text-text-muted shrink-0">パスワード:</span>
              <span className="font-medium text-text-main tracking-[0.2em]">********</span>
            </div>
            <button type="button" className="gt-btn text-xs" onClick={() => setIsPasswordModalOpen(true)}>
              パスワード変更
            </button>
          </div>
        </Card>

        {/* --- 3. アカウントの削除 --- */}
        <div className="rounded-lg border-2 border-danger/40 bg-danger/5 flex flex-col gap-4 p-8">
          <div className="flex justify-between items-center">
            <h2 className="font-serif font-semibold text-lg text-danger flex items-center gap-2">
              <AlertTriangle size={18} />
              アカウントの削除
            </h2>
          </div>
          <hr className="border-danger/20" />
          <div className="flex justify-between items-center gap-4">
            <span className="text-sm text-danger font-medium">
              あなたのログイン情報とプロフィールを完全に削除します。組織に登録した活動量・算定結果などのデータは削除されません。
            </span>
            <button
              type="button"
              className="gt-btn-primary text-xs bg-danger hover:bg-danger/90 shrink-0"
              onClick={() => setIsDeleteModalOpen(true)}
            >
              アカウント削除
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* --- パスワード変更モーダル --- */}
      <Modal isOpen={isPasswordModalOpen} onClose={closePasswordModal} title="パスワード変更">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="current-password" className="text-xs font-bold text-text-muted">
              現在のパスワード
            </label>
            <input
              id="current-password"
              type={showPassword ? 'text' : 'password'}
              className="gt-field"
              value={passwordForm.current}
              onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-password" className="text-xs font-bold text-text-muted">
              新しいパスワード
            </label>
            <input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              className="gt-field"
              value={passwordForm.new}
              onChange={(e) => setPasswordForm({ ...passwordForm, new: e.target.value })}
              placeholder="8文字以上"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="confirm-password" className="text-xs font-bold text-text-muted">
              新しいパスワード（確認）
            </label>
            <input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              className="gt-field"
              value={passwordForm.confirm}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2 mt-1">
            <input
              type="checkbox"
              id="showPwd"
              checked={showPassword}
              onChange={() => setShowPassword(!showPassword)}
              className="cursor-pointer accent-primary"
            />
            <label
              htmlFor="showPwd"
              className="text-xs text-text-muted flex items-center gap-1 cursor-pointer select-none"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              パスワードを表示
            </label>
          </div>

          <div className="mt-4 pt-4 border-t border-border flex justify-end gap-3">
            <button type="button" className="gt-btn text-sm" onClick={closePasswordModal} disabled={savingPassword}>
              キャンセル
            </button>
            <button
              type="button"
              className="gt-btn-primary text-sm"
              onClick={handlePasswordSave}
              disabled={
                savingPassword || !passwordForm.current || !passwordForm.new || !passwordForm.confirm
              }
            >
              {savingPassword ? '更新中...' : 'パスワード更新'}
            </button>
          </div>
        </div>
      </Modal>

      {/* --- アカウント削除モーダル --- */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeleteConfirmationText('');
        }}
        title="アカウントの完全な削除"
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-danger/20 bg-danger/5 text-danger text-sm">
            <div className="flex gap-3 px-5 py-4">
              <AlertTriangle size={20} className="shrink-0" />
              <p>
                <strong>警告:</strong>{' '}
                アカウントを削除すると、あなたのログイン情報とプロフィールが消去されます。組織に登録した活動量・算定結果などのデータは削除されず、組織に残ります。この操作は取り消せません。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <label htmlFor="delete-confirmation" className="text-sm font-medium">
              確認のため、下に <strong>DELETE</strong> と入力してください:
            </label>
            <input
              id="delete-confirmation"
              type="text"
              className="gt-field border-danger focus:border-danger focus:ring-danger"
              value={deleteConfirmationText}
              onChange={(e) => setDeleteConfirmationText(e.target.value)}
              placeholder="DELETE"
            />
          </div>

          <div className="mt-4 pt-4 border-t border-border flex justify-end gap-3">
            <button
              type="button"
              className="gt-btn text-sm"
              onClick={() => {
                setIsDeleteModalOpen(false);
                setDeleteConfirmationText('');
              }}
              disabled={deleting}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="gt-btn-primary text-sm bg-danger hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleDeleteAccount}
              disabled={deleteConfirmationText !== 'DELETE' || deleting}
            >
              {deleting ? '削除中...' : 'アカウント削除'}
            </button>
          </div>
        </div>
      </Modal>

      {toast && (
        <div
          className={`fixed top-5 right-5 z-[9999] flex items-center gap-3 px-6 py-4 rounded-md border shadow-md animate-toast-in ${
            toast.type === 'success'
              ? 'bg-primary/5 border-primary/30 text-primary'
              : 'bg-danger/5 border-danger/30 text-danger'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="text-sm font-semibold text-text-main">{toast.message}</span>
        </div>
      )}
    </>
  );
};
