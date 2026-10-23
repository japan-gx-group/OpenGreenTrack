// 提供元の共通の型（サーバ専用）。呼び出し側は提供元ごとの違いを知らずに済むよう、ここに揃える。

import 'server-only';
import type { AiModelOption, AiProviderId } from '@/types/ai';

export interface AiProvider {
  id: AiProviderId;
  /**
   * 提供元のモデル一覧を取得し、画像・PDF を読めて決まった形（JSON スキーマ）で出力できるものに絞って返す。
   * 失敗したら AiProviderError を投げる。一覧の取得に利用料はかからない。
   */
  listModels(apiKey: string, signal?: AbortSignal): Promise<AiModelOption[]>;
}
