'use client';

// 使えるモデルの一覧（GET /api/ai/models）を読む。管理者だけが呼べるので、enabled が true のときだけ取得する
// （管理者でない人の画面では一覧の API を呼ばない）。一覧はキャッシュせず、開いたときと「再取得」のときに取る。

import { useCallback, useEffect, useState } from 'react';
import type { AiModelOption } from '@/types/ai';

interface AiModelsResult {
  models: AiModelOption[];
  error: string | null;
}

const fetchAiModels = async (): Promise<AiModelsResult> => {
  try {
    const response = await fetch('/api/ai/models', { cache: 'no-store' });
    const body: unknown = await response.json().catch(() => null);
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    if (!response.ok) {
      return {
        models: [],
        error: typeof record.error === 'string' ? record.error : 'モデルの一覧の取得に失敗しました',
      };
    }
    return { models: Array.isArray(record.models) ? (record.models as AiModelOption[]) : [], error: null };
  } catch {
    return { models: [], error: '通信に失敗しました。時間をおいて再度お試しください' };
  }
};

export const useAiModels = (enabled: boolean) => {
  const [state, setState] = useState<AiModelsResult & { loaded: boolean; isReloading: boolean }>({
    models: [],
    error: null,
    loaded: false,
    isReloading: false,
  });

  const apply = useCallback((result: AiModelsResult) => {
    setState({ ...result, loaded: true, isReloading: false });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    fetchAiModels().then(apply);
  }, [enabled, apply]);

  const reload = useCallback(async () => {
    setState((prev) => ({ ...prev, isReloading: true }));
    apply(await fetchAiModels());
  }, [apply]);

  return {
    models: state.models,
    error: state.error,
    /** 取得中か（初回の取得と再取得） */
    isLoading: enabled && (!state.loaded || state.isReloading),
    /** 一度でも取得を終えたか */
    loaded: state.loaded,
    reload,
  };
};
