// 提供元の REST API を呼ぶ共通の処理（サーバ専用）。
//
// - SDK は使わず fetch で呼ぶ（新しい依存を入れない）。送信先はコードに固定した URL だけ。
// - リダイレクトは追わない（固定した送信先から別のホストへ向け直されないようにする）。
// - HTTP のエラーは AiErrorCode に揃える。提供元のエラー本文は分類にだけ使い、
//   例外のメッセージ・ログ・画面には出さない（OpenAI の鍵の誤りのメッセージには鍵の一部が含まれることがある）。

import 'server-only';
import type { AiErrorCode } from '@/types/ai';

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  /** 提供元が返した HTTP ステータス。通信に失敗した場合は null */
  readonly status: number | null;

  constructor(code: AiErrorCode, status: number | null = null) {
    // メッセージには鍵・本文を入れない（ログにそのまま出てもよい内容だけにする）。
    super(`AI の提供元の呼び出しに失敗しました（${code}${status ? `・HTTP ${status}` : ''}）`);
    this.name = 'AiProviderError';
    this.code = code;
    this.status = status;
  }
}

/** モデル一覧の取得の打ち切り時間 */
export const LIST_MODELS_TIMEOUT_MS = 15_000;

/** 1 回の一覧の取得で辿るページの上限（提供元の応答が壊れていても回り続けないように） */
export const MAX_LIST_PAGES = 10;

/** 生成（読取り・下書きなど）の打ち切り時間 */
export const GENERATE_TIMEOUT_MS = 60_000;

/**
 * 決まった形で出力させた文字列を JSON として読む。読めなければ bad_response。
 * 形を指定していても、まれにコードブロック（```json … ```）で囲まれて返ることがあるため、囲みだけは外す。
 */
export const parseJsonOutput = (text: unknown): unknown => {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiProviderError('bad_response');
  }
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unfenced) as unknown;
  } catch {
    throw new AiProviderError('bad_response');
  }
};

/** JSON の本文で POST する */
export const postJson = (
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  classify: ClassifyHttpError,
) =>
  fetchProviderJson(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    },
    classify,
  );

/** 提供元の HTTP エラー（ステータスと本文）を分類に変える。本文は分類にだけ使い、ログに出さないこと */
export type ClassifyHttpError = (status: number, body: unknown) => AiErrorCode;

/** 提供元に共通する HTTP ステータスの分類。提供元ごとの違いは各提供元の classify で先に判定する */
export const classifyHttpStatus = (status: number): AiErrorCode => {
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402) return 'billing';
  if (status === 404) return 'model_unavailable';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 413 || status === 422) return 'input_rejected';
  if (status >= 500) return 'overloaded';
  return 'unknown';
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** 呼び出し元の中断と、打ち切り時間のどちらでも止まるシグナル */
export const withTimeout = (timeoutMs: number, signal?: AbortSignal): AbortSignal => {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

export const fetchProviderJson = async (
  url: string,
  init: RequestInit,
  classify: ClassifyHttpError,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: 'error', cache: 'no-store' });
  } catch (error) {
    throw new AiProviderError(isAbortError(error) ? 'timeout' : 'unknown');
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new AiProviderError(classify(response.status, body), response.status);
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new AiProviderError('bad_response', response.status);
  }
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** ISO 8601 の日時から YYYY-MM-DD を取り出す。形が違えば null */
export const toDateOnly = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
