'use client';

// AI の設定の状態（GET /api/ai/status）を読む。全メンバーが呼べる（鍵の値は返らない）。

import { useCallback, useEffect, useState } from 'react';
import type { AiStatus } from '@/types/ai';

interface AiStatusResult {
  status: AiStatus | null;
  error: string | null;
}

const fetchAiStatus = async (): Promise<AiStatusResult> => {
  try {
    const response = await fetch('/api/ai/status', { cache: 'no-store' });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : 'AI の設定の取得に失敗しました';
      return { status: null, error: message };
    }
    return { status: body as AiStatus, error: null };
  } catch {
    return { status: null, error: '通信に失敗しました。時間をおいて再度お試しください' };
  }
};

export const useAiStatus = () => {
  const [state, setState] = useState<AiStatusResult & { isLoading: boolean }>({
    status: null,
    error: null,
    isLoading: true,
  });

  // 取得と反映を分け、.then(apply) の形で呼ぶ（react-hooks/set-state-in-effect 対応。MemberList と同じ方針）。
  const apply = useCallback((result: AiStatusResult) => {
    setState({ ...result, isLoading: false });
  }, []);

  useEffect(() => {
    fetchAiStatus().then(apply);
  }, [apply]);

  const refresh = useCallback(async () => apply(await fetchAiStatus()), [apply]);

  return { ...state, refresh };
};
