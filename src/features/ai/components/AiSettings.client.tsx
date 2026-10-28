'use client';

// 企業・メンバー設定の「AI の設定」カード。
// AI を使う機能で使う提供元とモデルを表示し、管理者にだけモデルの選択と保存を出す。
// API キーの置き場所は環境変数で決まる（画面からは切り替えられない）:
//   方式A: 環境変数で管理する。画面には「設定済み / 未設定」だけを出す
//   方式B: 管理者が画面から登録する（AiKeyForm。本人確認つき）。画面には末尾 4 文字と更新日時だけを出す
// 権限の正しさは GET /api/ai/models と Server Action（requireAdmin・本人確認）で確かめ、画面は出し分けだけにする。

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/datetime';
import { AI_PROVIDER_LABELS, type AiModelOption, type AiStatus } from '@/types/ai';
import { AiKeyForm } from './AiKeyForm.client';
import { saveAiModel } from '../services/aiSettingsActions';
import { useAiModels } from '../hooks/useAiModels';
import { useAiStatus } from '../hooks/useAiStatus';

// 設定の手順（セットアップガイドの「2-I. AI の設定（任意）」）。設定は .env.local などの環境変数で行う。
const AI_SETUP_DOC_URL =
  'https://github.com/japan-gx-group/OpenGreenTrack/blob/main/docs/setup-guide.md#2-i-ai-の設定任意';

// API キーの欄の表示（方式ごと）。
const apiKeyText = (status: AiStatus): { text: string; warn: boolean } => {
  if (status.keySource === 'server') {
    return status.configured
      ? { text: '設定済み', warn: false }
      : { text: '未設定（またはサーバの設定が不足しています）', warn: true };
  }
  if (status.needsReRegistration) {
    return {
      text: '登録し直してください（暗号化の鍵が変わったか、登録した提供元が今は許可されていません）',
      warn: true,
    };
  }
  if (status.registeredKey) {
    return {
      text: `登録済み（末尾 ${status.registeredKey.last4}・${formatDateTime(status.registeredKey.updatedAt)} 更新）`,
      warn: false,
    };
  }
  return { text: '未登録', warn: true };
};

const modelLabel = (model: AiModelOption): string => {
  const name = model.displayName === model.id ? model.id : `${model.displayName}（${model.id}）`;
  if (!model.deprecated) return name;
  return model.retiresOn ? `${name} — ${model.retiresOn} に廃止予定` : `${name} — 廃止予定`;
};

export const AiSettings = ({
  showToast,
}: {
  showToast: (message: string, type: 'success' | 'error') => void;
}) => {
  const { status, error: statusError, isLoading: isStatusLoading, refresh } = useAiStatus();
  const canChooseModel = Boolean(status?.canManage && status.configured);
  const models = useAiModels(canChooseModel);
  // null = まだ選んでいない（保存済みのモデルを表示する）
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const savedModelId = status?.modelId ?? null;
  const currentValue = selectedModelId ?? savedModelId ?? '';
  const activeModels = models.models.filter((model) => !model.deprecated);
  const deprecatedModels = models.models.filter((model) => model.deprecated);
  const savedModelMissing =
    models.loaded && !models.error && savedModelId !== null && !models.models.some((m) => m.id === savedModelId);

  const handleSave = async () => {
    if (isSaving || !currentValue) return;
    setIsSaving(true);
    try {
      const result = await saveAiModel(currentValue);
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      showToast('AI のモデルを保存しました', 'success');
      setSelectedModelId(null);
      await refresh();
    } catch {
      showToast('通信に失敗しました。時間をおいて再度お試しください', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h2 className="font-serif font-semibold text-lg text-text-heading">AI の設定</h2>
        {status && !status.canManage && (
          <span className="text-xs text-text-muted">管理者のみ変更できます</span>
        )}
      </div>
      <p className="text-xs text-text-muted">
        AI を使う機能で使う提供元とモデルです。組織の全員が同じ設定を使います。
        {status?.keySource === 'app'
          ? 'API キーは管理者が画面から登録し、暗号化して保存します（画面には末尾 4 文字だけを表示します）。'
          : 'API キーはサーバの環境変数で管理し、画面には表示しません。'}
      </p>
      <hr className="border-border" />

      {isStatusLoading && (
        <p className="text-sm text-text-muted py-2">
          <Loader2 size={16} className="animate-spin inline-block mr-2" />
          読み込んでいます...
        </p>
      )}
      {!isStatusLoading && statusError && <p className="text-sm text-danger py-2">{statusError}</p>}

      {status && (
        <dl className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-4 gap-y-3 text-sm">
          <dt className="text-text-muted">鍵の管理</dt>
          <dd className="text-text-main">
            {status.keySource === 'app' ? '画面から登録（方式B）' : '環境変数（サーバの設定）'}
          </dd>

          <dt className="text-text-muted">提供元</dt>
          <dd className="text-text-main">{status.provider ? AI_PROVIDER_LABELS[status.provider] : '未設定'}</dd>

          <dt className="text-text-muted">API キー</dt>
          <dd className={apiKeyText(status).warn ? 'text-warning' : 'text-text-main'}>{apiKeyText(status).text}</dd>

          <dt className="text-text-muted">
            {canChooseModel ? <label htmlFor="ai-model">モデル</label> : 'モデル'}
          </dt>
          <dd className="text-text-main flex flex-col gap-2">
            {!canChooseModel && <span>{status.configured ? (savedModelId ?? '未選択') : '—'}</span>}

            {canChooseModel && (
              <>
                <div className="flex items-center gap-2">
                  <select
                    id="ai-model"
                    className="gt-field min-w-0 flex-1"
                    value={currentValue}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    disabled={models.isLoading || isSaving}
                  >
                    <option value="">モデルを選んでください</option>
                    {savedModelMissing && savedModelId && (
                      <option value={savedModelId} disabled>
                        {savedModelId}（提供元の一覧にありません）
                      </option>
                    )}
                    {activeModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {modelLabel(model)}
                      </option>
                    ))}
                    {deprecatedModels.length > 0 && (
                      <optgroup label="廃止予定のモデル">
                        {deprecatedModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {modelLabel(model)}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => models.reload()}
                    disabled={models.isLoading}
                    className="gt-btn text-xs flex items-center gap-1 whitespace-nowrap"
                    title="提供元からモデルの一覧を取り直す"
                  >
                    <RefreshCw size={14} />
                    再取得
                  </button>
                </div>
                {models.isLoading && <span className="text-xs text-text-muted">モデルの一覧を取得しています…</span>}
                {!models.isLoading && models.error && <span className="text-xs text-danger">{models.error}</span>}
                {!models.isLoading && !models.error && models.loaded && models.models.length === 0 && (
                  <span className="text-xs text-warning">
                    この API キーで使える、画像・PDF を読めて決まった形で出力できるモデルが見つかりません
                  </span>
                )}
                {savedModelMissing && (
                  <span className="text-xs text-warning" role="alert">
                    選択中のモデル（{savedModelId}）は提供元の一覧にありません。廃止された可能性があるため、選び直してください
                  </span>
                )}
                <span className="text-xs text-text-muted">
                  一覧は提供元から取得し、画像・PDF を読めて決まった形で出力できるモデルに絞っています。
                </span>
              </>
            )}
          </dd>
        </dl>
      )}

      {status?.canManage && status.keySource === 'app' && (
        <AiKeyForm
          key={status.registeredKey ? `${status.registeredKey.provider}-${status.registeredKey.updatedAt}` : 'new'}
          mode="register"
          allowedProviders={status.allowedProviders}
          registeredKey={status.registeredKey}
          showToast={showToast}
          onChanged={refresh}
        />
      )}

      {status?.canManage && status.keySource === 'server' && status.leftoverKey && (
        <AiKeyForm mode="cleanup" allowedProviders={[]} registeredKey={null} showToast={showToast} onChanged={refresh} />
      )}

      {status && status.keySource === 'server' && !status.configured && (
        <p className="text-xs text-text-muted">
          AI を使うには、サーバの環境変数に提供元（AI_PROVIDER）と API キー（AI_API_KEY）を設定します。手順は{' '}
          <a
            href={AI_SETUP_DOC_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            セットアップガイド「2-I. AI の設定」
          </a>
          を参照してください。
        </p>
      )}

      {canChooseModel && (
        <div className="flex flex-col items-end gap-2 border-t border-border pt-4">
          <p className="text-xs text-text-muted self-start">
            使ってよい API キーは、法人契約で、送った内容を学習に使わない設定のものだけです。Gemini は有料枠（課金を有効にしたプロジェクト）の鍵を使ってください。
          </p>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !currentValue || currentValue === savedModelId}
            className="gt-btn-primary flex items-center gap-2 text-xs"
          >
            {isSaving && <Loader2 size={14} className="animate-spin" />}
            モデルを保存
          </button>
        </div>
      )}
    </Card>
  );
};
