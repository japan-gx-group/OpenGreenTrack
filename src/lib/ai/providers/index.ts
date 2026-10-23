// 提供元 ID → 提供元の処理（サーバ専用）。対応する提供元はこの 3 社だけ（送信先の URL は各ファイルに固定）。

import 'server-only';
import type { AiProviderId } from '@/types/ai';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { openAiProvider } from './openai';
import type { AiProvider } from './types';

const PROVIDERS: Record<AiProviderId, AiProvider> = {
  anthropic: anthropicProvider,
  google: googleProvider,
  openai: openAiProvider,
};

export const getAiProvider = (id: AiProviderId): AiProvider => PROVIDERS[id];

export { AiProviderError } from './http';
export type { AiProvider } from './types';
