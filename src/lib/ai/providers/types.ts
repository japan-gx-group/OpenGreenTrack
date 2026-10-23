// 提供元の共通の型（サーバ専用）。呼び出し側は提供元ごとの違いを知らずに済むよう、ここに揃える。

import 'server-only';
import type { AiModelOption, AiProviderId } from '@/types/ai';
import type { AiPreparedInput } from '../inputCheck';
import type { AiJsonSchema } from '../schema';

export interface AiGenerateRequest {
  apiKey: string;
  modelId: string;
  /** 機能が決める固定の指示文（利用者の入力は混ぜない。利用者の文は input の text で渡す） */
  instructions: string;
  input: AiPreparedInput[];
  /** 出力の形（findPortableSchemaProblems が空になる書き方） */
  schema: AiJsonSchema;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  id: AiProviderId;
  /**
   * 提供元のモデル一覧を取得し、画像・PDF を読めて決まった形（JSON スキーマ）で出力できるものに絞って返す。
   * 失敗したら AiProviderError を投げる。一覧の取得に利用料はかからない。
   */
  listModels(apiKey: string, signal?: AbortSignal): Promise<AiModelOption[]>;
  /**
   * 入力を送り、決まった形の出力（JSON として読んだもの。中身の検証はまだ）を返す。
   * 拒否・出力の打ち切り・JSON として読めない応答は AiProviderError('bad_response') を投げる。
   * ツールは渡さない。提供元に送った内容を保存させない（OpenAI は store: false）。
   */
  generate(request: AiGenerateRequest): Promise<unknown>;
}
