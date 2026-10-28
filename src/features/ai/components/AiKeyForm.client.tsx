'use client';

// 画面から登録する AI の API キー（方式B）のフォーム。管理者だけに出す。
// - mode="register": 方式B のとき。提供元の選択・API キー・ログインパスワード（本人確認）で登録・差し替え・削除する
// - mode="cleanup": 方式A のときに、以前に方式B で登録した鍵が DB に残っている場合。削除だけを出す
// API キーの入力欄は書き込みだけ（保存した鍵は表示しない。カードには末尾 4 文字と更新日時だけが出る）。
// 権限の正しさ（管理者・本人確認・方式）は Server Action（aiCredentialActions.ts）で確かめ、画面は出し分けだけにする。

import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AI_PROVIDER_LABELS, type AiProviderId, type AiStatus } from '@/types/ai';
import { deleteAiCredential, saveAiCredential } from '../services/aiCredentialActions';

export const AiKeyForm = ({
  mode,
  allowedProviders,
  registeredKey,
  showToast,
  onChanged,
}: {
  mode: 'register' | 'cleanup';
  allowedProviders: AiProviderId[];
  registeredKey: AiStatus['registeredKey'];
  showToast: (message: string, type: 'success' | 'error') => void;
  onChanged: () => Promise<void> | void;
}) => {
  const [form, setForm] = useState<{ provider: AiProviderId | ''; apiKey: string; password: string }>({
    provider: registeredKey?.provider ?? allowedProviders[0] ?? '',
    apiKey: '',
    password: '',
  });
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);

  const finish = async (message: string) => {
    showToast(message, 'success');
    setForm((prev) => ({ ...prev, apiKey: '', password: '' }));
    await onChanged();
  };

  const handleSave = async () => {
    if (busy || !form.provider) return;
    setBusy('save');
    try {
      const result = await saveAiCredential({ provider: form.provider, apiKey: form.apiKey, password: form.password });
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      await finish(`API キーを登録しました（末尾 ${result.data.last4}）`);
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy('delete');
    try {
      const result = await deleteAiCredential({ password: form.password });
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      await finish('登録した API キーを削除しました');
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      setBusy(null);
    }
  };

  const passwordField = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="ai-key-reauth" className="text-sm font-semibold text-text-muted">
        ログインパスワード（本人確認）
      </label>
      <input
        id="ai-key-reauth"
        type="password"
        autoComplete="current-password"
        className="gt-field"
        value={form.password}
        onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
      />
      <p className="text-xs text-text-muted">
        OpenGreenTrack にログインするときのパスワードです。AI 提供元のパスワードではありません。API キーの登録・削除のたびに入力します。
      </p>
    </div>
  );

  if (mode === 'cleanup') {
    return (
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-sm text-warning" role="alert">
          以前に画面から登録した API キーが DB に残っています。画面からの登録（方式B）に戻すとまた使われるため、使わない場合は削除してください。
        </p>
        {passwordField}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy !== null || !form.password}
            className="gt-btn text-xs text-danger border-danger flex items-center gap-2"
          >
            {busy === 'delete' && <Loader2 size={14} className="animate-spin" />}
            残っている API キーを削除
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="font-serif font-semibold text-sm text-text-heading">
        {registeredKey ? 'API キーの差し替え' : 'API キーの登録'}
      </h3>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ai-key-provider" className="text-sm font-semibold text-text-muted">
          提供元
        </label>
        <select
          id="ai-key-provider"
          className="gt-field"
          value={form.provider}
          onChange={(e) => setForm((prev) => ({ ...prev, provider: e.target.value as AiProviderId }))}
        >
          {allowedProviders.map((provider) => (
            <option key={provider} value={provider}>
              {AI_PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ai-key-value" className="text-sm font-semibold text-text-muted">
          API キー
        </label>
        <input
          id="ai-key-value"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="gt-field"
          value={form.apiKey}
          onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
        />
        <p className="text-xs text-text-muted">
          登録した API キーは暗号化して保存し、画面には末尾 4 文字だけを表示します。登録の前に、その鍵で提供元に接続できるかを確かめます。
        </p>
      </div>
      {passwordField}
      <p className="text-xs text-text-muted">
        使ってよい API キーは、法人契約で、送った内容を学習に使わない設定のものだけです。Gemini は有料枠（課金を有効にしたプロジェクト）の鍵を使ってください。
      </p>
      <div className="flex justify-end gap-2">
        {registeredKey && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy !== null || !form.password}
            className="gt-btn text-xs text-danger border-danger flex items-center gap-2"
          >
            {busy === 'delete' && <Loader2 size={14} className="animate-spin" />}
            登録した API キーを削除
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={busy !== null || !form.provider || !form.apiKey.trim() || !form.password}
          className="gt-btn-primary text-xs flex items-center gap-2"
        >
          {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
          {registeredKey ? '差し替える' : '登録する'}
        </button>
      </div>
    </div>
  );
};
